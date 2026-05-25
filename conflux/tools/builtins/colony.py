"""Colony tools — spawn and manage worker agents from within an agent run."""
from __future__ import annotations

import structlog

from conflux.tools.registry import ToolDefinition, ToolRegistry

logger = structlog.get_logger(__name__)


async def _list_agents(args: dict, context) -> dict:
    """List available agents in the colony."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.agent import Agent

    agent_type_filter = args.get("agent_type")

    async with get_db_session() as db:
        q = select(Agent).where(Agent.is_enabled == True)  # noqa: E712
        if agent_type_filter:
            q = q.where(Agent.agent_type == agent_type_filter)
        result = await db.execute(q)
        agents = result.scalars().all()

    return {
        "agents": [
            {
                "id": str(a.id),
                "name": a.name,
                "type": a.agent_type,
                "description": a.description or "",
                "tools": a.tool_allowlist or [],
            }
            for a in agents
        ]
    }


async def _spawn_agent(args: dict, context) -> dict:
    """Spawn a worker agent and wait for it to complete."""
    from conflux.agents.colony import Colony

    agent_id = str(args.get("agent_id", "")).strip()
    task = str(args.get("task", "")).strip()
    timeout = float(args.get("timeout_seconds", 300))

    if not agent_id:
        return {"error": "agent_id is required"}
    if not task:
        return {"error": "task is required"}

    colony = Colony(parent_run_id=context.run_id)

    try:
        child_run_id = await colony.spawn(agent_id, task, context)
        logger.info("Worker spawned", child_run_id=child_run_id, agent_id=agent_id, parent=context.run_id)
        member = await colony.wait_for(child_run_id, timeout=timeout)
        return {
            "run_id": child_run_id,
            "status": member.status,
            "result": member.result,
        }
    except TimeoutError:
        return {"error": f"Worker did not complete within {timeout}s", "run_id": child_run_id}
    except Exception as exc:
        logger.exception("spawn_agent tool failed", agent_id=agent_id, run_id=context.run_id)
        return {"error": str(exc)}


async def _spawn_swarm(args: dict, context) -> dict:
    """Spawn multiple worker agents in parallel and collect all results."""
    from conflux.agents.colony import Colony

    tasks_raw = args.get("tasks", [])
    timeout = float(args.get("timeout_seconds", 600))

    if not isinstance(tasks_raw, list) or not tasks_raw:
        return {"error": "tasks must be a non-empty list of {agent_id, task} objects"}

    colony = Colony(parent_run_id=context.run_id)
    run_ids: list[str] = []

    for item in tasks_raw:
        agent_id = str(item.get("agent_id", "")).strip()
        task = str(item.get("task", "")).strip()
        if not agent_id or not task:
            continue
        child_id = await colony.spawn(agent_id, task, context)
        run_ids.append(child_id)

    if not run_ids:
        return {"error": "No valid tasks to spawn"}

    logger.info("Swarm launched", count=len(run_ids), parent=context.run_id)
    members = await colony.wait_all(run_ids, timeout=timeout)

    return {
        "spawned": len(run_ids),
        "results": [
            {
                "run_id": m.run_id,
                "agent_id": m.agent_id,
                "status": m.status,
                "result": m.result,
            }
            for m in members
        ],
    }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="list_agents",
            description="List available agents in the Conflux colony. Optionally filter by agent_type (orchestrator, worker, specialist).",
            parameters={
                "type": "object",
                "properties": {
                    "agent_type": {
                        "type": "string",
                        "description": "Filter by agent type: orchestrator, worker, specialist",
                    }
                },
                "required": [],
            },
            risk_level="safe",
            fn=_list_agents,
        )
    )

    registry.register(
        ToolDefinition(
            name="spawn_agent",
            description=(
                "Spawn a worker agent to handle a subtask. "
                "The worker runs to completion and returns its result. "
                "Use list_agents first to find the right agent_id."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "UUID of the agent to spawn as a worker",
                    },
                    "task": {
                        "type": "string",
                        "description": "The task or prompt to give the worker agent",
                    },
                    "timeout_seconds": {
                        "type": "number",
                        "description": "Max seconds to wait for the worker (default 300)",
                        "default": 300,
                    },
                },
                "required": ["agent_id", "task"],
            },
            risk_level="moderate",
            fn=_spawn_agent,
        )
    )

    registry.register(
        ToolDefinition(
            name="spawn_swarm",
            description=(
                "Spawn multiple worker agents in parallel. "
                "Each task runs concurrently; all results are returned together. "
                "Use for tasks that can be parallelized."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "description": "List of {agent_id, task} objects to run in parallel",
                        "items": {
                            "type": "object",
                            "properties": {
                                "agent_id": {"type": "string"},
                                "task": {"type": "string"},
                            },
                            "required": ["agent_id", "task"],
                        },
                    },
                    "timeout_seconds": {
                        "type": "number",
                        "description": "Max seconds to wait for all workers (default 600)",
                        "default": 600,
                    },
                },
                "required": ["tasks"],
            },
            risk_level="moderate",
            fn=_spawn_swarm,
        )
    )
