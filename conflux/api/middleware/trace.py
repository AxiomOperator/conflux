"""Request trace middleware — records every inbound HTTP call to the DB."""
from __future__ import annotations

import asyncio
import time
from typing import Callable

import structlog
from jose import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from conflux.core.database import get_db_session

LOGGER = structlog.get_logger(__name__)

_SKIP_PREFIXES = ("/docs", "/redoc", "/openapi.json", "/health", "/favicon")
_REDACT_PATHS = ("/v1/auth/", "/v1/users/me/password")
_MAX_BODY = 2000
_MAX_CAPTURE_BYTES = _MAX_BODY * 4


def _truncate(text: str, max_len: int = _MAX_BODY) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"… [{len(text) - max_len} chars truncated]"


def _should_skip(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _SKIP_PREFIXES)


def _should_redact(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _REDACT_PATHS)


def _extract_user_email(request: Request) -> str | None:
    user_email = request.headers.get("x-user-email")
    if user_email:
        return user_email

    authorization = request.headers.get("authorization")
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    try:
        claims = jwt.get_unverified_claims(token)
    except Exception:
        return None

    candidate = claims.get("preferred_username") or claims.get("email") or claims.get("sub")
    return str(candidate) if candidate else None


def _extract_remote_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    forwarded_ip = forwarded_for.split(",")[0].strip()
    if forwarded_ip:
        return forwarded_ip
    if request.client:
        return request.client.host
    return None


def _decode_preview(body: bytes, *, fallback_binary: bool = False, overflow: bool = False) -> str | None:
    if not body:
        return None

    try:
        preview = _truncate(body.decode("utf-8", errors="replace"))
    except Exception:
        return "<binary>" if fallback_binary else None

    if overflow and len(preview) <= _MAX_BODY:
        return f"{preview}… [truncated preview]"
    return preview


class RequestTraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if _should_skip(path):
            return await call_next(request)

        start = time.monotonic()
        redact = _should_redact(path)
        request_body_raw = b""

        try:
            request_body_raw = await request.body()
        except Exception:
            pass

        async def _receive() -> dict[str, object]:
            return {"type": "http.request", "body": request_body_raw, "more_body": False}

        request._receive = _receive  # noqa: SLF001

        request_body = None
        if request_body_raw and not redact:
            request_body = _decode_preview(request_body_raw, fallback_binary=True)

        trace_kwargs = {
            "method": request.method,
            "path": path,
            "query_string": request.url.query or None,
            "user_email": _extract_user_email(request),
            "remote_ip": _extract_remote_ip(request),
            "user_agent": request.headers.get("user-agent"),
            "request_body": request_body,
        }

        try:
            response = await call_next(request)
        except Exception:
            asyncio.create_task(
                _save_trace(
                    **trace_kwargs,
                    status_code=500,
                    duration_ms=round((time.monotonic() - start) * 1000, 2),
                    response_body=None,
                )
            )
            raise

        response_chunks = bytearray()
        response_overflow = False
        original_iterator = response.body_iterator

        async def _logging_iterator():
            nonlocal response_overflow
            try:
                async for chunk in original_iterator:
                    if not redact and chunk:
                        remaining = _MAX_CAPTURE_BYTES - len(response_chunks)
                        if remaining > 0:
                            response_chunks.extend(chunk[:remaining])
                        if len(chunk) > remaining:
                            response_overflow = True
                    yield chunk
            finally:
                response_body = None
                if not redact:
                    response_body = _decode_preview(bytes(response_chunks), overflow=response_overflow)

                asyncio.create_task(
                    _save_trace(
                        **trace_kwargs,
                        status_code=response.status_code,
                        duration_ms=round((time.monotonic() - start) * 1000, 2),
                        response_body=response_body,
                    )
                )

        response.body_iterator = _logging_iterator()
        return response


async def _save_trace(**kwargs) -> None:
    try:
        from conflux.models.traces import RequestTrace

        async with get_db_session() as db:
            db.add(RequestTrace(**kwargs))
    except Exception as exc:
        LOGGER.warning("trace_save_failed", error=str(exc))
