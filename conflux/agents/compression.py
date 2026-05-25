from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.models.agent import Agent, AgentRun
from conflux.models.session import Message
from conflux.providers.base import ChatMessage, CompletionRequest, ProviderError
from conflux.providers.registry import get_provider_registry, refresh_provider_registry

_COMPRESSION_SYSTEM_PROMPT = """You compress long-running AI conversations so they can continue with minimal context.
Preserve the user's goals, constraints, decisions, important facts, completed work, pending tasks, and open questions.
Write a compact summary that lets another model resume the session accurately."""


def _visible_message_clause():
    return or_(
        Message.run_id.is_(None),
        AgentRun.id.is_(None),
        AgentRun.is_undone.is_(False),
    )


def _normalize_message(message: Any) -> dict[str, str] | None:
    if not isinstance(message, dict):
        return None
    role = str(message.get("role") or "user").strip() or "user"
    content = str(message.get("content") or "").strip()
    if not content:
        return None
    return {"role": role, "content": content}


def normalize_messages(messages: list[dict[str, Any]] | list[Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for message in messages:
        cleaned = _normalize_message(message)
        if cleaned:
            normalized.append(cleaned)
    return normalized


def build_summary_system_message(summary: str) -> dict[str, str]:
    return {
        "role": "system",
        "content": f"[Previous conversation summary]\n{summary.strip()}",
    }


def _format_messages_for_prompt(messages: list[dict[str, str]]) -> str:
    lines: list[str] = []
    for message in messages:
        role = message["role"].upper()
        lines.append(f"{role}: {message['content']}")
    return "\n\n".join(lines)


async def _resolve_provider(agent: Agent | None):
    registry = get_provider_registry()
    try:
        registry.get_default()
    except KeyError:
        registry = await refresh_provider_registry()

    provider_name = None
    model_name = None
    if agent:
        policy = agent.model_policy or {}
        raw_provider = policy.get("provider")
        raw_model = policy.get("model")
        provider_name = str(raw_provider).strip() if raw_provider else None
        model_name = str(raw_model).strip() if raw_model else None

    provider = None
    if provider_name:
        try:
            provider = registry.get(provider_name)
        except KeyError:
            provider = None

    if provider is None:
        provider = registry.get_default()

    resolved_model = model_name or getattr(provider, "default_model", "") or registry.get_default_model_name()
    if not resolved_model:
        raise ProviderError("No model configured for session compression.", getattr(provider, "provider_type", "unknown"))
    return provider, resolved_model


async def summarize_messages(messages: list[dict[str, Any]], agent: Agent | None = None) -> str:
    normalized = normalize_messages(messages)
    if not normalized:
        raise ValueError("No conversation history available to compress.")

    provider, model_name = await _resolve_provider(agent)
    prompt = (
        "Summarize this conversation concisely, preserving key facts, decisions, constraints, completed work, pending work, and outcomes.\n\n"
        f"Conversation:\n{_format_messages_for_prompt(normalized)}"
    )
    response = await provider.complete(
        CompletionRequest(
            messages=[
                ChatMessage(role="system", content=_COMPRESSION_SYSTEM_PROMPT),
                ChatMessage(role="user", content=prompt),
            ],
            model=model_name,
            temperature=0.2,
            max_tokens=700,
        )
    )
    summary = (response.content or "").strip()
    if not summary:
        raise ValueError("Compression model returned an empty summary.")
    return summary


def _extract_run_output_content(run: AgentRun) -> str | None:
    if not isinstance(run.output, dict):
        return None
    content = run.output.get("content")
    if content is None:
        return None
    text = str(content).strip()
    return text or None


async def get_run_history_for_compression(db: AsyncSession, run: AgentRun) -> list[dict[str, str]]:
    if run.session_id:
        max_sequence_result = await db.execute(
            select(func.max(Message.sequence)).where(
                Message.session_id == run.session_id,
                Message.run_id == run.id,
            )
        )
        max_sequence = max_sequence_result.scalar_one_or_none()
        if max_sequence is not None:
            rows = await db.execute(
                select(Message.role, Message.content)
                .outerjoin(AgentRun, AgentRun.id == Message.run_id)
                .where(
                    Message.session_id == run.session_id,
                    Message.sequence <= max_sequence,
                    _visible_message_clause(),
                )
                .order_by(Message.sequence.asc())
            )
            messages = [
                message
                for role, content in rows.all()
                if (message := _normalize_message({"role": role, "content": content}))
            ]
            if messages:
                return messages

    history = normalize_messages(run.input.get("messages", []) if isinstance(run.input, dict) else [])
    output_content = _extract_run_output_content(run)
    if output_content:
        final_message = {"role": "assistant", "content": output_content}
        if not history or history[-1] != final_message:
            history.append(final_message)
    return history


async def compress_run(db: AsyncSession, run: AgentRun) -> tuple[str, datetime]:
    agent_result = await db.execute(select(Agent).where(Agent.id == run.agent_id))
    agent = agent_result.scalar_one_or_none()
    history = await get_run_history_for_compression(db, run)
    summary = await summarize_messages(history, agent=agent)
    compressed_at = datetime.now(timezone.utc)
    run.compressed_context = summary
    run.is_compressed = True
    run.updated_at = compressed_at
    await db.flush()
    return summary, compressed_at


async def get_session_compression_state(db: AsyncSession, session_id: UUID) -> dict[str, str | bool | None]:
    latest_run_result = await db.execute(
        select(AgentRun.id)
        .where(
            AgentRun.session_id == session_id,
            AgentRun.is_undone.is_(False),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    latest_run_id = latest_run_result.scalar_one_or_none()

    compressed_result = await db.execute(
        select(AgentRun.updated_at)
        .where(
            AgentRun.session_id == session_id,
            AgentRun.is_compressed.is_(True),
            AgentRun.is_undone.is_(False),
            AgentRun.compressed_context.is_not(None),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    compressed_at = compressed_result.scalar_one_or_none()
    return {
        "latest_run_id": str(latest_run_id) if latest_run_id else None,
        "is_compressed": compressed_at is not None,
        "compressed_at": compressed_at.isoformat() if compressed_at else None,
    }


async def get_compressed_messages_for_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    session_id: UUID,
    incoming_messages: list[dict[str, Any]],
) -> tuple[str | None, list[dict[str, str]]]:
    current_run_result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    current_run = current_run_result.scalar_one_or_none()
    normalized_incoming = normalize_messages(incoming_messages)
    if not current_run or not current_run.created_at:
        return None, normalized_incoming

    compressed_result = await db.execute(
        select(AgentRun)
        .where(
            AgentRun.session_id == session_id,
            AgentRun.is_compressed.is_(True),
            AgentRun.is_undone.is_(False),
            AgentRun.compressed_context.is_not(None),
            AgentRun.created_at < current_run.created_at,
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    compressed_run = compressed_result.scalar_one_or_none()
    if not compressed_run or not compressed_run.compressed_context:
        return None, normalized_incoming

    max_sequence_result = await db.execute(
        select(func.max(Message.sequence)).where(
            Message.session_id == session_id,
            Message.run_id == compressed_run.id,
        )
    )
    max_sequence = max_sequence_result.scalar_one_or_none()

    replay_messages: list[dict[str, str]] = []
    if max_sequence is not None:
        rows = await db.execute(
            select(Message.role, Message.content)
            .outerjoin(AgentRun, AgentRun.id == Message.run_id)
            .where(
                Message.session_id == session_id,
                Message.sequence > max_sequence,
                _visible_message_clause(),
            )
            .order_by(Message.sequence.asc())
        )
        replay_messages = [
            message
            for role, content in rows.all()
            if (message := _normalize_message({"role": role, "content": content}))
        ]

    latest_incoming = normalized_incoming[-1] if normalized_incoming else None
    if latest_incoming and (not replay_messages or replay_messages[-1] != latest_incoming):
        replay_messages.append(latest_incoming)

    return compressed_run.compressed_context, replay_messages
