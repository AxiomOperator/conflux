"""Trace recording - captures everything that happens during a run."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)


class TraceRecorder:
    """
    Records trace events for a single agent run.

    Traces are persisted to Postgres (TraceEvent table) for later reflection.
    """

    def __init__(self, run_id: str):
        self.run_id = run_id
        self._buffer: list[dict[str, Any]] = []

    async def record(self, event_type: str, payload: dict[str, Any]) -> None:
        """Record a trace event."""
        event = {
            "event_type": event_type,
            "payload": payload,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._buffer.append(event)
        await self._flush_one(event_type, payload)

    async def record_prompt(self, messages: list[dict[str, Any]], model: str, provider: str) -> None:
        await self.record("prompt", {"messages": messages, "model": model, "provider": provider})

    async def record_completion(
        self,
        content: str | None,
        tool_calls: list[Any] | None,
        tokens: dict[str, Any],
    ) -> None:
        await self.record(
            "completion",
            {"content": content, "tool_calls": tool_calls, "tokens": tokens},
        )

    async def record_tool_call(self, tool_name: str, args: dict[str, Any]) -> None:
        await self.record("tool_call", {"tool_name": tool_name, "args": args})

    async def record_tool_result(self, tool_name: str, result: dict[str, Any]) -> None:
        await self.record("tool_result", {"tool_name": tool_name, "result": result})

    async def record_error(self, error: str) -> None:
        await self.record("error", {"error": error})

    async def record_correction(
        self,
        original: str,
        corrected: str,
        by_user: bool = False,
    ) -> None:
        await self.record(
            "correction",
            {"original": original, "corrected": corrected, "by_user": by_user},
        )

    async def record_outcome(
        self,
        success: bool,
        summary: str,
        user_feedback: str | None = None,
    ) -> None:
        await self.record(
            "outcome",
            {"success": success, "summary": summary, "user_feedback": user_feedback},
        )

    async def _flush_one(self, event_type: str, payload: dict[str, Any]) -> None:
        try:
            from conflux.models.learning import TraceEvent

            async with get_db_session() as db:
                db.add(
                    TraceEvent(
                        run_id=self.run_id,
                        event_type=event_type,
                        payload=payload,
                    )
                )
        except Exception as exc:  # pragma: no cover - best-effort persistence
            logger.warning(
                "Failed to flush trace event",
                run_id=self.run_id,
                event_type=event_type,
                error=str(exc),
            )
