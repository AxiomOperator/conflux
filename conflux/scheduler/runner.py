"""Scheduled task runner - polls and fires due schedules."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import select

logger = structlog.get_logger(__name__)


async def tick_schedules(ctx: dict[str, Any]) -> None:
    """Arq job: find due scheduled tasks and spawn agent runs."""
    from conflux.core.database import get_db_session
    from conflux.models.schedule import ScheduledTask
    from conflux.scheduler.cron_parser import next_run_time

    now = datetime.now(timezone.utc)

    async with get_db_session() as db:
        result = await db.execute(
            select(ScheduledTask)
            .where(ScheduledTask.is_enabled.is_(True))
            .where(ScheduledTask.next_run.is_not(None))
            .where(ScheduledTask.next_run <= now)
        )
        due_tasks = result.scalars().all()

    fired = 0
    for task in due_tasks:
        async with get_db_session() as db:
            managed_task = await db.get(type(task), task.id)
            if managed_task is None or not managed_task.is_enabled:
                continue
            if managed_task.next_run is None or managed_task.next_run > now:
                continue

            try:
                await _fire_task(db, managed_task, now)
                managed_task.last_status = "success"
                fired += 1
            except Exception as exc:  # pragma: no cover - batch safety
                logger.error("scheduled_task_failed", task_id=str(managed_task.id), error=str(exc))
                managed_task.last_status = "error"
            finally:
                managed_task.last_run = now
                managed_task.next_run = next_run_time(managed_task.cron_expr, base=now)

    logger.info("tick_schedules_complete", fired=fired)


async def _fire_task(db, task, now: datetime) -> None:
    """Spawn an agent run for a scheduled task."""
    from conflux.agents.base import AgentConfig, RunContext
    from conflux.agents.loop import AgentLoop
    from conflux.models.agent import Agent, AgentRun

    result = await db.execute(select(Agent).where(Agent.id == task.agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.is_enabled:
        raise ValueError(f"Agent {task.agent_id} not found or disabled")

    messages = task.input_template.get("messages", []) if task.input_template else []
    if not messages:
        messages = [
            {
                "role": "user",
                "content": f"Scheduled run triggered at {now.isoformat()}",
            }
        ]

    run_id = uuid4()
    run = AgentRun(
        id=run_id,
        agent_id=agent.id,
        user_id=task.created_by,
        status="queued",
        input={"messages": messages, "scheduled_task_id": str(task.id)},
    )
    db.add(run)
    await db.flush()
    await db.commit()

    config = AgentConfig(
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
    run_ctx = RunContext(
        run_id=str(run_id),
        user_id=str(task.created_by) if task.created_by else None,
        session_id=None,
        tenant_id=str(agent.tenant_id) if agent.tenant_id else None,
        project_id=str(agent.project_id) if agent.project_id else None,
        channel=task.channel or "scheduler",
        input_messages=messages,
    )
    loop = AgentLoop(config=config, context=run_ctx)

    result_text = ""
    error_message: str | None = None
    try:
        async def _consume_loop() -> str:
            final_content = ""
            async for event in loop.run():
                if event.event_type == "done":
                    final_content = event.data.get("content") or ""
                elif event.event_type == "error":
                    raise RuntimeError(event.data.get("message") or "Scheduled run failed")
            return final_content

        result_text = await asyncio.wait_for(_consume_loop(), timeout=300)
    except asyncio.TimeoutError:
        error_message = "Timed out after 300s"
        raise
    except Exception as exc:
        error_message = str(exc)
        raise
    finally:
        await db.refresh(run)
        if error_message is None:
            run.status = "completed"
            run.output = {"text": result_text}
            run.error = None
        else:
            run.status = "failed"
            run.output = {"error": error_message}
            run.error = error_message
        await db.commit()

    if task.channel and task.channel_target and result_text:
        await _deliver_to_channel(task.channel, task.channel_target, result_text, task.name)


async def _deliver_to_channel(channel: str, target: str, text: str, task_name: str) -> None:
    """Deliver agent output to the specified channel."""
    if channel == "telegram":
        try:
            import httpx

            from conflux.channels.telegram import _md_to_telegram_html
            from conflux.core.config import get_settings

            settings = get_settings()
            if not settings.telegram_bot_token:
                raise ValueError("TELEGRAM_BOT_TOKEN is not configured")

            payload = {
                "chat_id": int(target) if target.lstrip("-").isdigit() else target,
                "text": _md_to_telegram_html(f"⏰ *{task_name}*\n\n{text}"),
                "parse_mode": "HTML",
            }
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                    json=payload,
                )
                response.raise_for_status()
        except Exception as exc:  # pragma: no cover - external API
            logger.warning("telegram_delivery_failed", error=str(exc))
    else:
        logger.info("channel_delivery_skipped", channel=channel, reason="not_implemented")
