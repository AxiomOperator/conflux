"""
Post-task reflection worker.
Analyzes completed run traces and decides what to learn:
- Write memory entries
- Draft new skills
- Patch existing skills
- Log lessons learned

This runs as an arq background job after every completed run.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import structlog

from conflux.core.config import get_settings
from conflux.core.events import publish_event
from conflux.core.database import get_db_session

logger = structlog.get_logger(__name__)


async def reflection_job(ctx: dict[str, Any], run_id: str) -> dict[str, Any]:
    """
    arq job: analyze a completed run and extract learnings.

    Triggered automatically after every AgentRun completes.
    Uses the LLM to reflect on the trace and determine what should be learned.
    """
    logger.info("Reflection job started", run_id=run_id)

    try:
        trace = await _load_trace(run_id)
        run_info = await _load_run(run_id)

        if not trace:
            logger.info("No trace events found, skipping reflection", run_id=run_id)
            return {"status": "skipped", "reason": "no_trace"}

        reflection_prompt = _build_reflection_prompt(run_info, trace)

        from conflux.providers.base import ChatMessage, CompletionRequest
        from conflux.providers.registry import get_provider_registry

        registry = get_provider_registry()
        provider = registry.get_default()

        request = CompletionRequest(
            messages=[
                ChatMessage(role="system", content=REFLECTION_SYSTEM_PROMPT),
                ChatMessage(role="user", content=reflection_prompt),
            ],
            model=registry.get_default_model_name(),
            stream=False,
        )

        response = await provider.complete(request)
        learnings = _parse_reflection_output(response.content or "")
        _queue_learning_event(
            "learning.proposed",
            run_info,
            {
                "summary": str(learnings.get("summary", ""))[:200],
                "memory_count": len(learnings.get("memories", [])),
                "skill_draft_count": len(learnings.get("skill_drafts", [])),
                "was_successful": learnings.get("was_successful"),
            },
        )

        memories_written: list[str] = []
        stored_memories: list[dict[str, Any]] = []
        skills_drafted: list[str] = []

        for memory in learnings.get("memories", []):
            await _write_memory(run_info, memory)
            if isinstance(memory, dict):
                stored_memories.append(memory)
            key = str(memory.get("key", "")).strip()
            if key:
                memories_written.append(key)

        for skill in learnings.get("skill_drafts", []):
            skill_id = await _draft_skill(run_info, skill)
            if skill_id:
                skills_drafted.append(skill_id)

        await _update_reflection_record(
            run_id,
            stored_memories,
            skills_drafted,
            was_successful=learnings.get("was_successful"),
        )
        _queue_learning_event(
            "learning.accepted",
            run_info,
            {
                "memory_count": len(stored_memories),
                "skill_draft_count": len(skills_drafted),
                "was_successful": learnings.get("was_successful"),
            },
        )

        logger.info(
            "Reflection complete",
            run_id=run_id,
            memories=len(memories_written),
            skills=len(skills_drafted),
        )

        try:
            from conflux.learning.skill_evaluator import schedule_skill_evaluation

            asyncio.create_task(schedule_skill_evaluation(run_id))
        except Exception as exc:
            logger.warning(
                "Failed to queue skill evaluation",
                run_id=run_id,
                error=str(exc),
            )

        return {
            "status": "ok",
            "memories": memories_written,
            "skills_drafted": skills_drafted,
        }
    except Exception as exc:  # pragma: no cover - background job safety
        logger.exception("Reflection job failed", run_id=run_id, error=str(exc))
        await _mark_reflection_failed(run_id, str(exc))
        return {"status": "error", "error": str(exc)}


def _queue_learning_event(
    event_type: str,
    run_info: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    try:
        asyncio.create_task(
            publish_event(
                event_type,
                payload,
                run_id=run_info.get("id"),
                agent_id=run_info.get("agent_id"),
                agent_name=run_info.get("agent_name"),
                user_id=run_info.get("user_id"),
                tenant_id=run_info.get("tenant_id"),
            )
        )
    except Exception as exc:
        logger.warning("Failed to queue learning event", event_type=event_type, error=str(exc))


REFLECTION_SYSTEM_PROMPT = """
You are the Conflux Learning System. Your job is to analyze a completed agent run and extract reusable learnings.

Return ONLY valid JSON in this exact format:
{
  "was_successful": true,
  "summary": "Brief description of what was accomplished",
  "memories": [
    {
      "key": "short-identifier",
      "value": "The fact or lesson learned",
      "scope": "user|project|tenant|global",
      "tags": ["tag1", "tag2"]
    }
  ],
  "skill_drafts": [
    {
      "name": "Skill Name",
      "description": "What this skill does",
      "category": "category",
      "content": "Full SKILL.md markdown content with ## When to Use, ## Procedure, ## Pitfalls, ## Verification sections"
    }
  ],
  "should_draft_skill": true,
  "reasoning": "Why these learnings were extracted"
}

Guidelines:
- Draft a skill whenever the run demonstrates a reusable workflow, even if only 1-2 tool calls were made. Examples: looking up real-time data, calling an external API, executing a multi-step search. If the technique could help future runs, draft it.
- Write memories for: user preferences, environment facts, corrections, domain knowledge discovered, API quirks, tool-call patterns that worked
- Keep skill content concise but complete - focus on what was learned and how to replicate it
- Use scope "user" for personal preferences, "global" for generally applicable facts
- Lean toward creating skills and memories — it is better to draft something than to leave the system with nothing learned
- Only return empty arrays when the run was a pure failure with no recoverable insight
""".strip()


def _build_reflection_prompt(run_info: dict[str, Any], trace: list[dict[str, Any]]) -> str:
    """Build the reflection prompt from run info + trace events."""
    tool_calls = [event for event in trace if event.get("event_type") == "tool_call"]
    errors = [event for event in trace if event.get("event_type") == "error"]
    tools_used = sorted(
        {
            str(event.get("payload", {}).get("tool_name", "")).strip()
            for event in tool_calls
            if str(event.get("payload", {}).get("tool_name", "")).strip()
        }
    )

    summary = f"""
Run ID: {run_info.get('id')}
Status: {run_info.get('status')}
Agent: {run_info.get('agent_name', 'unknown')}
Tool calls made: {len(tool_calls)}
Errors encountered: {len(errors)}
Tools used: {tools_used}
Input: {str(run_info.get('input', {}))[:500]}
Output: {str(run_info.get('output', {}))[:500]}
Errors: {[event.get('payload', {}).get('error') for event in errors[:3]]}
""".strip()

    return f"Analyze this completed agent run and extract learnings:\n\n{summary}"


def _parse_reflection_output(content: str) -> dict[str, Any]:
    """Parse LLM reflection output as JSON."""
    default = {"memories": [], "skill_drafts": []}
    text = content.strip()
    if not text:
        return default

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else default
    except json.JSONDecodeError:
        pass

    json_match = re.search(r"\{.*\}", text, re.DOTALL)
    if not json_match:
        return default

    try:
        parsed = json.loads(json_match.group())
    except json.JSONDecodeError:
        return default
    return parsed if isinstance(parsed, dict) else default


async def _load_trace(run_id: str) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from conflux.models.learning import TraceEvent

    async with get_db_session() as db:
        result = await db.execute(select(TraceEvent).where(TraceEvent.run_id == run_id))
        events = result.scalars().all()
        return [{"event_type": event.event_type, "payload": event.payload} for event in events]


async def _load_run(run_id: str) -> dict[str, Any]:
    from sqlalchemy import select

    from conflux.models.agent import Agent, AgentRun

    async with get_db_session() as db:
        result = await db.execute(
            select(AgentRun, Agent.name)
            .join(Agent, AgentRun.agent_id == Agent.id, isouter=True)
            .where(AgentRun.id == run_id)
        )
        row = result.first()
        if not row:
            return {}

        run, agent_name = row
        return {
            "id": str(run.id),
            "agent_id": str(run.agent_id) if run.agent_id else None,
            "status": run.status,
            "input": run.input,
            "output": run.output,
            "agent_name": agent_name,
            "user_id": str(run.user_id) if run.user_id else None,
            "tenant_id": None,
            "project_id": None,
        }


async def _write_memory(run_info: dict[str, Any], memory: dict[str, Any]) -> None:
    from sqlalchemy.dialects.postgresql import insert

    from conflux.models.memory import Memory

    scope = str(memory.get("scope", "user") or "user")
    scope_id = {
        "user": run_info.get("user_id"),
        "tenant": run_info.get("tenant_id"),
        "project": run_info.get("project_id"),
        "global": None,
    }.get(scope, run_info.get("user_id"))

    async with get_db_session() as db:
        stmt = insert(Memory).values(
            scope=scope,
            scope_id=scope_id,
            key=memory.get("key"),
            value=memory.get("value"),
            tags=memory.get("tags", []),
            user_id=run_info.get("user_id"),
        ).on_conflict_do_update(
            index_elements=["scope", "scope_id", "key"],
            set_={
                "value": memory.get("value"),
                "tags": memory.get("tags", []),
            },
        )
        await db.execute(stmt)


async def _draft_skill(run_info: dict[str, Any], skill: dict[str, Any]) -> str | None:
    from slugify import slugify

    from conflux.models.skill import Skill, SkillVersion

    name = str(skill.get("name", "")).strip()
    if not name:
        return None

    slug = slugify(name)

    async with get_db_session() as db:
        new_skill = Skill(
            name=name,
            slug=slug,
            description=skill.get("description", ""),
            category=skill.get("category", "general"),
            approval_status="draft",
            owner_user_id=run_info.get("user_id"),
            tenant_id=run_info.get("tenant_id"),
            project_id=run_info.get("project_id"),
        )
        db.add(new_skill)
        await db.flush()

        version = SkillVersion(
            skill_id=new_skill.id,
            version=1,
            content=skill.get("content", ""),
            change_summary="Auto-drafted by reflection worker",
        )
        db.add(version)
        await db.flush()

        return str(new_skill.id)


async def _update_reflection_record(
    run_id: str,
    memories: list[dict[str, Any]],
    skills: list[str],
    was_successful: bool | None = None,
) -> None:
    from sqlalchemy import update

    from conflux.models.learning import ReflectionJob

    values: dict[str, Any] = {
        "status": "completed",
        "learned_memories": memories,
        "drafted_skills": skills,
    }
    if was_successful is not None:
        values["was_successful"] = bool(was_successful)

    async with get_db_session() as db:
        await db.execute(
            update(ReflectionJob).where(ReflectionJob.run_id == run_id).values(**values)
        )


async def _mark_reflection_failed(run_id: str, error: str) -> None:
    from sqlalchemy import update

    from conflux.models.learning import ReflectionJob

    try:
        async with get_db_session() as db:
            await db.execute(
                update(ReflectionJob)
                .where(ReflectionJob.run_id == run_id)
                .values(status="failed", error=error)
            )
    except Exception as update_exc:  # pragma: no cover - best-effort failure tracking
        logger.warning(
            "Failed to update reflection failure record",
            run_id=run_id,
            error=str(update_exc),
        )


async def schedule_reflection(run_id: str) -> None:
    """Schedule a reflection job for a completed run."""
    import arq

    from conflux.models.learning import ReflectionJob

    settings = get_settings()

    async with get_db_session() as db:
        db.add(ReflectionJob(run_id=run_id, status="pending"))

    pool = await arq.create_pool(
        arq.connections.RedisSettings.from_dsn(settings.dragonfly_url)
    )
    try:
        await pool.enqueue_job("reflection_job", run_id)
    finally:
        await pool.aclose()
