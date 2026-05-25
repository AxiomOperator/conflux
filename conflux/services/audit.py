"""Fire-and-forget audit event logger."""
from __future__ import annotations

import asyncio
import json

import structlog

from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)
_MAX_PREVIEW = 1500


def _truncate(obj: object, max_len: int = _MAX_PREVIEW) -> str:
    try:
        text = json.dumps(obj, default=str)
    except Exception:
        text = str(obj)
    if len(text) > max_len:
        return text[:max_len] + f"… [{len(text) - max_len} chars truncated]"
    return text


async def _write_event(**kwargs) -> None:
    try:
        from conflux.models.audit import AuditEvent

        async with get_db_session() as db:
            db.add(AuditEvent(**kwargs))
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("audit_write_failed", error=str(exc))


def log_audit_event(**kwargs) -> None:
    """Schedule a fire-and-forget audit write. Safe to call from sync or async code."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_write_event(**kwargs))
    except RuntimeError:
        asyncio.run(_write_event(**kwargs))
