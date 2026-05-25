"""Diagnostic health check routes and helpers."""
from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.core.cache import get_redis
from conflux.core.config import get_settings
from conflux.core.vector import get_qdrant
from conflux.providers.registry import get_provider_registry

Status = Literal["ok", "degraded", "error"]

router = APIRouter()
admin_router = APIRouter()


class DoctorCheck(BaseModel):
    service: str
    status: Status
    latency_ms: int
    message: str = ""


class DoctorResponse(BaseModel):
    overall: Status
    checks: list[DoctorCheck] = Field(default_factory=list)


def _truncate_message(message: str, limit: int = 160) -> str:
    clean = " ".join((message or "").split())
    return clean if len(clean) <= limit else f"{clean[: limit - 1]}…"


async def _timed_check(
    service: str,
    checker: Callable[[], Awaitable[tuple[Status, str]]],
) -> DoctorCheck:
    started = time.perf_counter()
    try:
        status, message = await checker()
    except Exception as exc:
        status, message = "error", str(exc)
    latency_ms = round((time.perf_counter() - started) * 1000)
    return DoctorCheck(
        service=service,
        status=status,
        latency_ms=latency_ms,
        message=_truncate_message(message),
    )


async def collect_doctor_report(db: AsyncSession) -> DoctorResponse:
    settings = get_settings()
    checks: list[DoctorCheck] = []

    async def _postgres() -> tuple[Status, str]:
        await db.execute(text("SELECT 1"))
        return "ok", ""

    async def _qdrant() -> tuple[Status, str]:
        await get_qdrant().get_collections()
        return "ok", ""

    async def _dragonfly() -> tuple[Status, str]:
        await get_redis().ping()
        return "ok", ""

    async def _searxng() -> tuple[Status, str]:
        timeout = max(settings.searxng_timeout_ms / 1000, 1)
        base_url = settings.searxng_url.rstrip("/")
        async with httpx.AsyncClient(timeout=timeout) as client:
            health = await client.get(f"{base_url}/healthz")
            if health.status_code == 200:
                return "ok", ""
            if health.status_code != 404:
                health.raise_for_status()
            base = await client.get(base_url)
            if base.status_code in {200, 401, 403, 404}:
                return "ok", "Base URL reachable (/healthz unavailable)"
            base.raise_for_status()
        return "ok", ""

    checks.append(await _timed_check("postgres", _postgres))
    checks.append(await _timed_check("qdrant", _qdrant))
    checks.append(await _timed_check("dragonflydb", _dragonfly))
    checks.append(await _timed_check("searxng", _searxng))
    checks.extend(await _collect_provider_checks())

    if any(check.status == "error" for check in checks):
        overall: Status = "error"
    elif any(check.status == "degraded" for check in checks):
        overall = "degraded"
    else:
        overall = "ok"

    return DoctorResponse(overall=overall, checks=checks)


async def _collect_provider_checks() -> list[DoctorCheck]:
    registry = get_provider_registry()
    provider_list_fn = getattr(registry, "list", None)
    entries = provider_list_fn() if callable(provider_list_fn) else registry.list_providers()
    if not entries:
        return [
            DoctorCheck(
                service="llm:registry",
                status="degraded",
                latency_ms=0,
                message="No LLM providers configured",
            )
        ]

    checks: list[DoctorCheck] = []
    for entry in entries:
        started = time.perf_counter()
        status: Status = "ok"
        message = ""
        try:
            provider = registry.get(entry["name"])
            base_url = str(getattr(provider, "base_url", "")).strip()
            default_model = str(getattr(provider, "default_model", "")).strip()
            if not base_url:
                status = "error"
                message = "Missing base URL"
            elif not default_model:
                status = "degraded"
                message = "Missing default model"
        except Exception as exc:
            status = "error"
            message = str(exc)
        checks.append(
            DoctorCheck(
                service=f"llm:{entry['name']}",
                status=status,
                latency_ms=round((time.perf_counter() - started) * 1000),
                message=_truncate_message(message),
            )
        )
    return checks


def format_doctor_markdown(report: DoctorResponse) -> str:
    icon_map = {"ok": "🟢", "degraded": "🟡", "error": "🔴"}
    lines = [
        "# Diagnostics Report",
        "",
        f"**Overall:** {icon_map[report.overall]} **{report.overall.upper()}**",
        "",
    ]
    for check in report.checks:
        detail = f" · {check.message}" if check.message else ""
        lines.append(
            f"- {icon_map[check.status]} **{check.service}** — {check.latency_ms} ms{detail}"
        )
    return "\n".join(lines)


@router.get("/doctor", response_model=DoctorResponse)
async def doctor_status(db: DB, user: CurrentUser):
    return await collect_doctor_report(db)


@admin_router.get("/doctor", response_model=DoctorResponse)
async def admin_doctor_status(db: DB, user: AdminUser):
    return await collect_doctor_report(db)
