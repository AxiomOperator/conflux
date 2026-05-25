#!/usr/bin/env python3
"""
Synapse Live Test — pumps realistic agent activity events into DragonflyDB
so you can watch the neural graph come alive at https://synapse.example.com

Usage:
    python scripts/test_synapse.py              # run full demo sequence once
    python scripts/test_synapse.py --loop       # loop forever until Ctrl+C
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from uuid import uuid4

import redis.asyncio as aioredis

DRAGONFLY_URL = "redis://localhost:6379"
STREAM_KEY = "synapse:events"


def event(
    event_type: str,
    data: dict,
    *,
    run_id: str,
    agent_id: str,
    agent_name: str,
    user_id: str = "user-abc123",
    tenant_id: str = "demo",
) -> dict:
    return {
        "id": str(uuid4()),
        "type": event_type,
        "ts": int(time.time() * 1000),
        "run_id": run_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "data": json.dumps(data),
    }


async def publish(r: aioredis.Redis, payload: dict) -> None:
    await r.xadd(STREAM_KEY, payload, maxlen=10000, approximate=True)


async def demo_scenario(r: aioredis.Redis, run_num: int = 1) -> None:
    """Simulate a full agent run: spawn → tools → memory → learning → complete."""
    run_id = f"run-test-{run_num:03d}"
    orchestrator_id = f"agent-orchestrator-{run_num}"
    researcher_id = f"agent-researcher-{run_num}"
    writer_id = f"agent-writer-{run_num}"
    user_id = f"user-{run_num % 3 + 1:03d}"

    print(f"\n▶  Run {run_num}: {run_id}")

    steps = [
        # 1. Orchestrator starts
        (0.3, event("agent.started", {"model": "gpt-4o"},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 2. Orchestrator reasons
        (0.5, event("agent.reasoning", {"step": "planning subtasks"},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 3. Spawn researcher
        (0.4, event("spawn.requested",
                    {"child_agent_id": researcher_id, "role": "researcher"},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 4. Researcher starts
        (0.3, event("agent.started", {"model": "claude-3-5-sonnet", "role": "researcher"},
                    run_id=run_id, agent_id=researcher_id,
                    agent_name="Researcher", user_id=user_id)),

        # 5. Researcher searches memory
        (0.6, event("memory.searched", {"scope": "global", "query": "conflux architecture"},
                    run_id=run_id, agent_id=researcher_id,
                    agent_name="Researcher", user_id=user_id)),

        # 6. Researcher calls web search tool
        (0.5, event("tool.called", {"name": "web_search", "query": "FastAPI SSE streaming"},
                    run_id=run_id, agent_id=researcher_id,
                    agent_name="Researcher", user_id=user_id)),

        # 7. Tool completes
        (0.8, event("tool.completed", {"name": "web_search", "results": 5},
                    run_id=run_id, agent_id=researcher_id,
                    agent_name="Researcher", user_id=user_id)),

        # 8. Spawn writer
        (0.4, event("spawn.requested",
                    {"child_agent_id": writer_id, "role": "writer"},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 9. Writer starts
        (0.3, event("agent.started", {"model": "gpt-4o-mini", "role": "writer"},
                    run_id=run_id, agent_id=writer_id,
                    agent_name="Writer", user_id=user_id)),

        # 10. Writer calls code tool
        (0.6, event("tool.called", {"name": "code_exec", "language": "python"},
                    run_id=run_id, agent_id=writer_id,
                    agent_name="Writer", user_id=user_id)),

        # 11. Memory search during writing
        (0.5, event("memory.searched", {"scope": "user", "query": "user preferences"},
                    run_id=run_id, agent_id=writer_id,
                    agent_name="Writer", user_id=user_id)),

        # 12. Code tool completes
        (0.7, event("tool.completed", {"name": "code_exec", "exit_code": 0},
                    run_id=run_id, agent_id=writer_id,
                    agent_name="Writer", user_id=user_id)),

        # 13. Learning proposed
        (0.4, event("learning.proposed",
                    {"rule": "Use vite preview for Synapse, not bun run start",
                     "confidence": 0.91},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 14. Learning accepted
        (0.5, event("learning.accepted",
                    {"rule": "Use vite preview for Synapse, not bun run start",
                     "applied": True},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),

        # 15. Researcher done
        (0.4, event("agent.completed", {"tokens": 1240},
                    run_id=run_id, agent_id=researcher_id,
                    agent_name="Researcher", user_id=user_id)),

        # 16. Writer done
        (0.3, event("agent.completed", {"tokens": 890},
                    run_id=run_id, agent_id=writer_id,
                    agent_name="Writer", user_id=user_id)),

        # 17. Orchestrator done
        (0.4, event("agent.completed", {"tokens": 450, "total_tokens": 2580},
                    run_id=run_id, agent_id=orchestrator_id,
                    agent_name="Orchestrator", user_id=user_id)),
    ]

    for delay, payload in steps:
        await asyncio.sleep(delay)
        await publish(r, payload)
        print(f"   {'✓':2} {payload['type']:28} [{payload['agent_name']}]")


async def main(loop: bool) -> None:
    print("Synapse Live Test")
    print(f"  Stream:  {STREAM_KEY} @ {DRAGONFLY_URL}")
    print(f"  Watch:   https://synapse.example.com")
    print()

    r = aioredis.from_url(DRAGONFLY_URL, decode_responses=True)

    try:
        await r.ping()
        print("✔  DragonflyDB connected\n")
    except Exception as e:
        print(f"✗  Cannot connect to DragonflyDB: {e}", file=sys.stderr)
        sys.exit(1)

    run = 1
    try:
        while True:
            await demo_scenario(r, run)
            run += 1
            if not loop:
                break
            print(f"\n   ⏸  Pausing 3s before next run… (Ctrl+C to stop)")
            await asyncio.sleep(3)
    except KeyboardInterrupt:
        print("\n\nStopped.")
    finally:
        await r.aclose()

    print(f"\n✔  Done — {run - 1} run(s) published to Synapse stream.")
    print("   Open https://synapse.example.com to see the graph.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pump test events into Synapse stream")
    parser.add_argument("--loop", action="store_true", help="Loop forever until Ctrl+C")
    args = parser.parse_args()
    asyncio.run(main(args.loop))
