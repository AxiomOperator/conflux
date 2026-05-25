"""
Synapse event publisher — publishes agent activity events to DragonflyDB stream.
Events are consumed by the Synapse visualization app in real time.
"""
from __future__ import annotations

import json
import time
from uuid import uuid4

from conflux.core.cache import get_redis

STREAM_KEY = "synapse:events"
MAX_STREAM_LEN = 10000  # approximate max events to keep


async def publish_event(
    event_type: str,
    data: dict,
    *,
    run_id: str | None = None,
    agent_id: str | None = None,
    agent_name: str | None = None,
    user_id: str | None = None,
    tenant_id: str | None = None,
) -> None:
    """Publish a structured event to the Synapse stream. Never raises."""
    try:
        r = get_redis()
        payload = {
            "id": str(uuid4()),
            "type": event_type,
            "ts": int(time.time() * 1000),
            "run_id": run_id or "",
            "agent_id": agent_id or "",
            "agent_name": agent_name or "",
            "user_id": user_id or "",
            "tenant_id": tenant_id or "",
            "data": json.dumps(data),
        }
        await r.xadd(STREAM_KEY, payload, maxlen=MAX_STREAM_LEN, approximate=True)
    except Exception:
        pass  # never let event publishing break the agent
