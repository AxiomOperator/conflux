"""Admin endpoints for AgentMail inbox management."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import structlog
from agentmail import AsyncAgentMail
from agentmail.core.api_error import ApiError
from agentmail.environment import AgentMailEnvironment
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from conflux.api.auth import AdminUser
from conflux.core.config import get_settings

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/agentmail", tags=["agentmail"])


class InboxCreateBody(BaseModel):
    model_config = ConfigDict(extra="allow")

    display_name: str | None = None
    username: str | None = None
    domain: str | None = None


def _normalize_agentmail_http_base(api_url: str) -> str:
    base = (api_url or AgentMailEnvironment.PROD.http).strip().rstrip("/")
    if base.endswith("/v0"):
        base = base[:-3].rstrip("/")
    return base or AgentMailEnvironment.PROD.http


def _derive_agentmail_websocket_base(http_base: str) -> str:
    parsed = urlsplit(http_base)
    host = parsed.netloc
    if host.startswith("x402.api."):
        host = f"x402.ws.{host[len('x402.api.') :]}"
    elif host.startswith("mpp.api."):
        host = f"mpp.ws.{host[len('mpp.api.') :]}"
    elif host.startswith("api."):
        host = f"ws.{host[len('api.') :]}"
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, host, "", "", ""))


def _serialize(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(item) for item in value]
    return value


def _limit(limit: int) -> int:
    return max(1, min(limit, 100))


def _raise_api_error(exc: ApiError) -> None:
    raise HTTPException(
        status_code=exc.status_code or 502,
        detail=exc.body if exc.body is not None else str(exc),
    ) from exc


def _get_client() -> AsyncAgentMail:
    settings = get_settings()
    if not settings.agentmail_api_key:
        raise HTTPException(status_code=503, detail="AgentMail not configured")

    http_base = _normalize_agentmail_http_base(settings.agentmail_api_url)
    environment = (
        AgentMailEnvironment.PROD
        if http_base == AgentMailEnvironment.PROD.http
        else AgentMailEnvironment(
            http=http_base,
            websockets=_derive_agentmail_websocket_base(http_base),
        )
    )
    return AsyncAgentMail(api_key=settings.agentmail_api_key, environment=environment)


@router.get("/status")
async def get_status(_user: AdminUser):
    """Check if AgentMail is configured."""
    settings = get_settings()
    return {"configured": bool(settings.agentmail_api_key)}


@router.get("/inboxes")
async def list_inboxes(_user: AdminUser, limit: int = 20):
    client = _get_client()
    try:
        result = await client.inboxes.list(limit=_limit(limit))
        return _serialize(result)
    except ApiError as exc:
        _raise_api_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/inboxes", status_code=201)
async def create_inbox(body: InboxCreateBody, _user: AdminUser):
    client = _get_client()
    try:
        inbox = await client.inboxes.create(request=body.model_dump(exclude_none=True) or None)
        return _serialize(inbox)
    except ApiError as exc:
        _raise_api_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/inboxes/{inbox_id}")
async def delete_inbox(inbox_id: str, _user: AdminUser):
    client = _get_client()
    try:
        await client.inboxes.delete(inbox_id=inbox_id)
        return {"deleted": True}
    except ApiError as exc:
        _raise_api_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/inboxes/{inbox_id}/messages")
async def list_messages(inbox_id: str, _user: AdminUser, limit: int = 20):
    client = _get_client()
    try:
        result = await client.inboxes.messages.list(inbox_id=inbox_id, limit=_limit(limit))
        return _serialize(result)
    except ApiError as exc:
        _raise_api_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/inboxes/{inbox_id}/threads")
async def list_threads(inbox_id: str, _user: AdminUser, limit: int = 20):
    client = _get_client()
    try:
        result = await client.inboxes.threads.list(inbox_id=inbox_id, limit=_limit(limit))
        return _serialize(result)
    except ApiError as exc:
        _raise_api_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/webhook")
async def agentmail_webhook(payload: dict[str, Any]):
    """Receive inbound email events from AgentMail."""
    logger.info(
        "AgentMail webhook received",
        event_type=payload.get("type"),
        inbox_id=payload.get("inbox_id"),
    )
    return {"received": True}
