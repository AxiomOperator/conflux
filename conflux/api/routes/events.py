"""
Synapse event stream — SSE endpoint for real-time harness activity.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncIterator

import structlog
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from conflux.core.cache import get_redis
from conflux.core.events import STREAM_KEY

logger = structlog.get_logger(__name__)
router = APIRouter(prefix='/v1/events', tags=['events'])

KEEPALIVE_INTERVAL = 15  # seconds between keepalive pings
MAX_HISTORY = 500  # max events returned by history endpoint


async def _event_stream(last_id: str = '$') -> AsyncIterator[str]:
    """Async generator that reads from DragonflyDB stream and yields SSE lines."""
    # Immediately flush a comment so headers reach the client without waiting for the
    # first keepalive (which would otherwise take up to KEEPALIVE_INTERVAL seconds).
    yield f': connected {int(time.time())}\n\n'

    r = get_redis()
    current_id = last_id
    last_keepalive = time.monotonic()

    while True:
        try:
            results = await r.xread(
                streams={STREAM_KEY: current_id},
                count=50,
                block=1000,
            )
            if results:
                for _stream_name, messages in results:
                    for msg_id, fields in messages:
                        current_id = msg_id
                        event_data = {
                            'id': fields.get('id', ''),
                            'type': fields.get('type', ''),
                            'ts': int(fields.get('ts', 0)),
                            'run_id': fields.get('run_id', ''),
                            'agent_id': fields.get('agent_id', ''),
                            'agent_name': fields.get('agent_name', ''),
                            'user_id': fields.get('user_id', ''),
                            'tenant_id': fields.get('tenant_id', ''),
                            'data': json.loads(fields.get('data', '{}')),
                        }
                        yield f"event: synapse\ndata: {json.dumps(event_data)}\n\n"

            now = time.monotonic()
            if now - last_keepalive >= KEEPALIVE_INTERVAL:
                last_keepalive = now
                yield f': keepalive {int(time.time())}\n\n'

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning('SSE stream error', error=str(exc))
            await asyncio.sleep(1)


@router.get('/stream')
async def stream_events(
    last_id: str = Query(default='$', description='Redis stream ID to start from ($ = latest)'),
):
    """
    SSE stream of live Synapse events.
    Connect with EventSource; each event is type 'synapse' with JSON data.
    """
    headers = {
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    }
    return StreamingResponse(
        _event_stream(last_id),
        media_type='text/event-stream',
        headers=headers,
    )


@router.get('/history')
async def get_event_history(
    limit: int = Query(default=100, le=MAX_HISTORY),
):
    """Return recent events from the stream (newest first)."""
    r = get_redis()
    try:
        messages = await r.xrevrange(STREAM_KEY, count=limit)
        events = []
        for msg_id, fields in messages:
            events.append(
                {
                    'stream_id': msg_id,
                    'id': fields.get('id', ''),
                    'type': fields.get('type', ''),
                    'ts': int(fields.get('ts', 0)),
                    'run_id': fields.get('run_id', ''),
                    'agent_id': fields.get('agent_id', ''),
                    'agent_name': fields.get('agent_name', ''),
                    'user_id': fields.get('user_id', ''),
                    'tenant_id': fields.get('tenant_id', ''),
                    'data': json.loads(fields.get('data', '{}')),
                }
            )
        return {'events': events, 'count': len(events)}
    except Exception as exc:
        logger.error('Failed to fetch event history', error=str(exc))
        return {'events': [], 'count': 0}
