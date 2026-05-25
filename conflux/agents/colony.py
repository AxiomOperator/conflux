from __future__ import annotations

"""Colony lifecycle manager — tracks and manages worker agent instances."""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import structlog

from conflux.agents.base import RunContext
from conflux.core.events import publish_event

logger = structlog.get_logger(__name__)


@dataclass
class ColonyMember:
    run_id: str
    agent_id: str
    agent_name: str
    status: str
    task_summary: str
    spawned_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    result: Any = None


class Colony:
    """Manage worker agent runs for a parent orchestrator run."""

    def __init__(self, parent_run_id: str):
        self.parent_run_id = parent_run_id
        self._members: dict[str, ColonyMember] = {}
        self._lock = asyncio.Lock()

    async def spawn(
        self,
        agent_id: str,
        task: str,
        context: RunContext,
    ) -> str:
        """Spawn a worker agent and return its run identifier."""
        from sqlalchemy import select

        from conflux.core.database import get_db_session
        from conflux.models.agent import AgentRun

        run_uuid = uuid.uuid4()
        run_id = str(run_uuid)
        parent_agent_id: str | None = None

        async with self._lock:
            self._members[run_id] = ColonyMember(
                run_id=run_id,
                agent_id=agent_id,
                agent_name=agent_id,
                status="spawning",
                task_summary=task[:200],
            )

        logger.info("Spawning worker", run_id=run_id, agent_id=agent_id, task=task[:100])

        async with get_db_session() as db:
            parent_agent_id = await db.scalar(
                select(AgentRun.agent_id).where(AgentRun.id == self._coerce_uuid(self.parent_run_id))
            )

            run = AgentRun(
                id=run_uuid,
                agent_id=self._coerce_uuid(agent_id),
                parent_run_id=self._coerce_uuid(self.parent_run_id),
                session_id=self._coerce_uuid(context.session_id),
                user_id=self._coerce_uuid(context.user_id),
                status="queued",
                input={"task": task},
            )
            db.add(run)

        asyncio.create_task(
            publish_event(
                "spawn.requested",
                {"child_agent_id": str(agent_id), "child_run_id": str(run_id)},
                run_id=str(self.parent_run_id),
                agent_id=str(parent_agent_id) if parent_agent_id else None,
                user_id=str(context.user_id) if context.user_id else None,
                tenant_id=str(context.tenant_id) if context.tenant_id else None,
            )
        )
        asyncio.create_task(self._execute_worker(run_id, agent_id, task, context))
        return run_id

    async def _execute_worker(
        self,
        run_id: str,
        agent_id: str,
        task: str,
        context: RunContext,
    ) -> None:
        """Execute a worker agent in the background."""
        from conflux.agents.loop import AgentLoop

        worker_context = RunContext(
            run_id=run_id,
            user_id=context.user_id,
            session_id=context.session_id,
            tenant_id=context.tenant_id,
            project_id=context.project_id,
            parent_run_id=self.parent_run_id,
            channel=context.channel,
            input_messages=[{"role": "user", "content": task}],
        )

        async with self._lock:
            self._members[run_id].status = "running"

        result_content: Any = ""
        worker_failed = False
        try:
            config = await self._load_agent_config(agent_id)
            loop = AgentLoop(config=config, context=worker_context)

            async for event in loop.run():
                if event.event_type == "done":
                    result_content = event.data.get("content", "")
                elif event.event_type == "error":
                    worker_failed = True
                    result_content = {"error": event.data.get("message", "Worker failed")}

            async with self._lock:
                member = self._members[run_id]
                member.status = "failed" if worker_failed else "completed"
                member.result = result_content
                member.completed_at = datetime.now(timezone.utc)
        except Exception as exc:
            logger.error("Worker failed", run_id=run_id, error=str(exc))
            async with self._lock:
                member = self._members[run_id]
                member.status = "failed"
                member.result = {"error": str(exc)}
                member.completed_at = datetime.now(timezone.utc)

    async def wait_for(self, run_id: str, timeout: float = 300.0) -> ColonyMember:
        """Wait for a worker to complete."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        while loop.time() < deadline:
            async with self._lock:
                member = self._members.get(run_id)
                if member and member.status in {"completed", "failed"}:
                    return member
            await asyncio.sleep(0.5)

        raise TimeoutError(f"Worker {run_id} did not complete within {timeout}s")

    async def wait_all(
        self,
        run_ids: list[str],
        timeout: float = 600.0,
    ) -> list[ColonyMember]:
        """Wait for multiple workers concurrently."""
        tasks = [self.wait_for(run_id, timeout=timeout) for run_id in run_ids]
        return await asyncio.gather(*tasks)

    def list_members(self) -> list[ColonyMember]:
        return list(self._members.values())

    async def _load_agent_config(self, agent_id: str):
        """Load AgentConfig from the database."""
        from sqlalchemy import select

        from conflux.agents.base import AgentConfig
        from conflux.core.database import get_db_session
        from conflux.models.agent import Agent

        async with get_db_session() as db:
            result = await db.execute(select(Agent).where(Agent.id == self._coerce_uuid(agent_id)))
            agent = result.scalar_one_or_none()

            if agent is None:
                raise ValueError(f"Agent not found: {agent_id}")

            return AgentConfig(
                agent_id=str(agent.id),
                name=agent.name,
                agent_type=agent.agent_type,
                system_prompt=agent.system_prompt,
                model_policy=agent.model_policy or {},
                tool_allowlist=agent.tool_allowlist or [],
                retrieval_tags=agent.retrieval_tags or [],
                max_iterations=agent.max_iterations,
                wiki_rag_enabled=agent.wiki_rag_enabled,
            )

    @staticmethod
    def _coerce_uuid(value: str | None) -> str | UUID | None:
        if value is None:
            return None
        try:
            return UUID(str(value))
        except (TypeError, ValueError):
            return value
