from __future__ import annotations

"""Core agentic execution loop."""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

import structlog

from conflux.agents.base import (
    AgentConfig,
    MaxIterationsError,
    ProviderNotFoundError,
    RunContext,
)
from conflux.core.database import get_db_session
from conflux.core.events import publish_event
from conflux.providers.base import ChatMessage, CompletionRequest
from conflux.providers.registry import get_provider_registry
from conflux.tools.registry import get_tool_registry

if TYPE_CHECKING:
    from conflux.tools.mcp_bridge import McpBridge
    from conflux.tools.registry import ToolRegistry

logger = structlog.get_logger(__name__)


@dataclass
class LoopEvent:
    """Event emitted during the agent loop for SSE streaming."""

    event_type: str
    data: dict[str, Any]


class AgentLoop:
    """Executes the agentic loop for a single run."""

    def __init__(self, config: AgentConfig, context: RunContext):
        self.config = config
        self.context = context
        self._messages: list[ChatMessage] = []
        self._iteration = 0
        self._event_sequence = 0
        self._mcp_bridge: "McpBridge | None" = None
        self._run_registry: "ToolRegistry | None" = None
        self._token_usage: dict[str, int] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }

    async def run(self) -> AsyncIterator[LoopEvent]:
        """Main loop. Yields LoopEvents for streaming."""
        try:
            await self._initialize()
            async for event in self._execute_loop():
                yield event
        except MaxIterationsError:
            message = f"Max iterations ({self.config.max_iterations}) reached"
            await self._safe_update_run_status(
                "failed",
                {"error": message},
                token_usage=self._token_usage if any(self._token_usage.values()) else None,
            )
            await self._record_run_event("error", {"message": message})
            yield LoopEvent("error", {"message": message})
        except Exception as exc:
            logger.exception("Agent loop error", run_id=self.context.run_id, error=str(exc))
            await self._safe_update_run_status(
                "failed",
                {"error": str(exc)},
                token_usage=self._token_usage if any(self._token_usage.values()) else None,
            )
            await self._record_run_event("error", {"message": str(exc)})
            yield LoopEvent("error", {"message": str(exc)})
        finally:
            await self._finalize()

    async def _initialize(self) -> None:
        """Build the initial message list from system prompt plus input."""
        from conflux.agents.compression import build_summary_system_message, get_compressed_messages_for_run

        system_prompt = await self._build_system_prompt()
        self._messages = [ChatMessage(role="system", content=system_prompt)]

        input_messages = self.context.input_messages
        if self.context.session_id:
            async with get_db_session() as db:
                compressed_context, input_messages = await get_compressed_messages_for_run(
                    db,
                    run_id=self._coerce_uuid(self.context.run_id),
                    session_id=self._coerce_uuid(self.context.session_id),
                    incoming_messages=self.context.input_messages,
                )
            if compressed_context:
                self._messages.append(ChatMessage(**build_summary_system_message(compressed_context)))

        for msg in input_messages:
            self._messages.append(ChatMessage(**msg))

        await self._update_run_status("running")

        from conflux.tools.mcp_bridge import McpBridge

        self._mcp_bridge = McpBridge()
        async with get_db_session() as db:
            self._run_registry = await self._mcp_bridge.load_for_agent(
                self.config.agent_id,
                db,
                get_tool_registry(),
            )

        await self._record_run_event("status", {"status": "running"})

    async def _execute_loop(self) -> AsyncIterator[LoopEvent]:
        """Core agentic loop: call model, execute tools, repeat."""
        registry = get_provider_registry()
        tool_registry = self._run_registry if self._run_registry is not None else get_tool_registry()

        provider_name = self.config.model_policy.get("provider")
        model = self.config.model_policy.get("model")
        temperature = self.config.model_policy.get("temperature", 0.7)

        try:
            provider = registry.get(provider_name) if provider_name else registry.get_default()
        except KeyError as exc:
            raise ProviderNotFoundError(
                f"Provider not found: {provider_name or 'default'}",
                run_id=self.context.run_id,
            ) from exc

        tools = tool_registry.get_tools_for_agent(self.config.tool_allowlist)

        while self._iteration < self.config.max_iterations:
            self._iteration += 1
            status_event = LoopEvent("status", {"iteration": self._iteration, "status": "thinking"})
            await self._record_run_event(status_event.event_type, status_event.data)
            await self._record_trace_event(
                step="iteration_started",
                input_payload={"message_count": len(self._messages), "tool_count": len(tools)},
            )
            yield status_event

            request = CompletionRequest(
                messages=self._messages,
                model=model,
                tools=tools,
                temperature=temperature,
                stream=True,
            )

            full_content = ""
            # Merge streaming tool-call deltas by index so we build one complete
            # entry per tool call rather than appending every raw chunk fragment.
            # vllm (and OpenAI) send incremental `arguments` strings that must be
            # concatenated, and `id`/`type` arrive only in the first chunk.
            tool_calls_by_index: dict[int, dict[str, Any]] = {}

            async for chunk in provider.stream(request):
                # Capture token usage from the final usage-only chunk
                if chunk.usage:
                    self._token_usage["prompt_tokens"] += chunk.usage.get("prompt_tokens", 0)
                    self._token_usage["completion_tokens"] += chunk.usage.get("completion_tokens", 0)
                    self._token_usage["total_tokens"] += chunk.usage.get("total_tokens", 0)

                if chunk.delta_content:
                    full_content += chunk.delta_content
                    token_event = LoopEvent("token", {"content": chunk.delta_content})
                    await self._record_run_event(token_event.event_type, token_event.data)
                    yield token_event

                if chunk.delta_tool_calls:
                    for tc_delta in chunk.delta_tool_calls:
                        idx = tc_delta.get("index", 0)
                        if idx not in tool_calls_by_index:
                            tool_calls_by_index[idx] = {
                                "id": None,
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        existing = tool_calls_by_index[idx]
                        if tc_delta.get("id"):
                            existing["id"] = tc_delta["id"]
                        if tc_delta.get("type"):
                            existing["type"] = tc_delta["type"]
                        fn_delta = tc_delta.get("function") or {}
                        if fn_delta.get("name"):
                            existing["function"]["name"] = fn_delta["name"]
                        if fn_delta.get("arguments"):
                            existing["function"]["arguments"] += fn_delta["arguments"]

                if chunk.finish_reason:
                    break

            tool_calls_accumulated = list(tool_calls_by_index.values())

            self._messages.append(
                ChatMessage(
                    role="assistant",
                    content=full_content or None,
                    tool_calls=tool_calls_accumulated or None,
                )
            )
            await self._record_trace_event(
                step="model_response",
                output_payload={
                    "content": full_content or None,
                    "tool_calls": tool_calls_accumulated or None,
                },
            )

            if not tool_calls_accumulated:
                done_event = LoopEvent("done", {"content": full_content})
                await self._record_run_event(done_event.event_type, done_event.data)
                yield done_event
                await self._update_run_status(
                    "completed",
                    output={"content": full_content},
                    token_usage=self._token_usage if any(self._token_usage.values()) else None,
                )
                trajectory_messages = self._serialize_trajectory_messages()
                if len(trajectory_messages) >= 2:
                    try:
                        asyncio.create_task(
                            self._capture_trajectory(
                                run_id=self.context.run_id,
                                messages=trajectory_messages,
                                system_prompt=self._messages[0].content if self._messages else None,
                            )
                        )
                    except Exception:
                        pass
                return

            for tool_call in tool_calls_accumulated:
                tool_name = tool_call.get("function", {}).get("name", "")
                args = self._parse_tool_args(tool_call.get("function", {}).get("arguments"))

                tool_call_event = LoopEvent("tool_call", {"name": tool_name, "args": args})
                await self._record_run_event(tool_call_event.event_type, tool_call_event.data)
                await self._record_trace_event(
                    step="tool_call",
                    input_payload={"name": tool_name, "args": args},
                )
                yield tool_call_event

                result = await tool_registry.execute(
                    tool_name=tool_name,
                    args=args,
                    context=self.context,
                )

                tool_result_event = LoopEvent("tool_result", {"name": tool_name, "result": result})
                await self._record_run_event(tool_result_event.event_type, tool_result_event.data)
                await self._record_trace_event(
                    step="tool_result",
                    input_payload={"name": tool_name},
                    output_payload={"result": result},
                )
                yield tool_result_event

                self._messages.append(
                    ChatMessage(
                        role="tool",
                        content=result if isinstance(result, str) else json.dumps(result),
                        tool_call_id=tool_call.get("id"),
                        name=tool_name,
                    )
                )

        raise MaxIterationsError(
            f"Reached max iterations ({self.config.max_iterations})",
            run_id=self.context.run_id,
        )

    def _serialize_trajectory_messages(self) -> list[dict[str, Any]]:
        start_index = 1 if self._messages and self._messages[0].role == "system" else 0
        serialized: list[dict[str, Any]] = []
        for message in self._messages[start_index:]:
            payload: dict[str, Any] = {"role": message.role, "content": message.content}
            if message.tool_calls is not None:
                payload["tool_calls"] = message.tool_calls
            if message.tool_call_id is not None:
                payload["tool_call_id"] = message.tool_call_id
            if message.name is not None:
                payload["name"] = message.name
            serialized.append(payload)
        return serialized

    async def _capture_trajectory(
        self,
        run_id: str | UUID | None,
        messages: list[dict[str, Any]],
        system_prompt: str | None,
    ) -> None:
        if len(messages) < 2:
            return
        try:
            from conflux.models.trajectory import Trajectory

            trajectory = Trajectory(
                run_id=self._coerce_uuid(str(run_id)) if run_id is not None else None,
                user_id=self._coerce_uuid(self.context.user_id),
                agent_id=self._coerce_uuid(self.config.agent_id),
                agent_name=self.config.name,
                system_prompt=system_prompt,
                messages=messages,
                message_count=len(messages),
                status="pending_review",
                input_tokens=self._token_usage.get("prompt_tokens", 0),
                output_tokens=self._token_usage.get("completion_tokens", 0),
            )
            async with get_db_session() as db:
                db.add(trajectory)
        except Exception:
            pass

    async def _fetch_persona_block(self) -> str:
        """Fetch user persona files and format as a system prompt block."""
        if not self.context.user_id:
            return ""
        try:
            from uuid import UUID as _UUID

            from conflux.api.routes.personality import get_personality_instruction
            from conflux.models.user import UserPersonaFiles

            async with get_db_session() as db:
                from sqlalchemy import select

                result = await db.execute(
                    select(UserPersonaFiles).where(
                        UserPersonaFiles.user_id == _UUID(self.context.user_id)
                    )
                )
                persona = result.scalar_one_or_none()

            if not persona:
                return ""

            parts = []
            # IDENTITY first — sets name/vibe context
            if persona.identity_md and persona.identity_md.strip():
                parts.append(persona.identity_md.strip())
            # SOUL — persona and tone
            if persona.soul_md and persona.soul_md.strip():
                parts.append(persona.soul_md.strip())
            # AGENTS — operating instructions
            if persona.agents_md and persona.agents_md.strip():
                parts.append(persona.agents_md.strip())
            # USER — who the user is
            if persona.user_md and persona.user_md.strip():
                parts.append(persona.user_md.strip())
            # TOOLS — local tool conventions
            if persona.tools_md and persona.tools_md.strip():
                parts.append(persona.tools_md.strip())
            personality_instruction = get_personality_instruction(persona.personality_preset)
            if personality_instruction:
                parts.append(personality_instruction)

            if not parts:
                return ""

            return "## User-Configured Agent Persona\n\n" + "\n\n---\n\n".join(parts)
        except Exception as exc:
            logger.warning("persona_injection_failed", run_id=self.context.run_id, error=str(exc))
            return ""

    async def _build_system_prompt(self) -> str:
        """Build the system prompt with injected persona, memory and skills."""
        prompt_parts = []

        # Persona block goes FIRST to establish identity/tone/instructions
        persona_block = await self._fetch_persona_block()
        if persona_block:
            prompt_parts.append(persona_block)

        # Agent's base system prompt
        prompt_parts.append(self.config.system_prompt)

        memories_block = await self._fetch_memories_block()
        if memories_block:
            prompt_parts.append(memories_block)

        skills_block = await self._fetch_skills_block()
        if skills_block:
            prompt_parts.append(skills_block)

        wiki_block = await self._fetch_wiki_block()
        if wiki_block:
            prompt_parts.append(wiki_block)

        return "\n\n".join(prompt_parts)

    def _get_query_for_rag(self) -> str:
        for msg in reversed(self.context.input_messages):
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            content = str(msg.get("content", "")).strip()
            if content:
                return content[:500]
        return ""

    async def _fetch_memories_block(self) -> str:
        """Fetch top-5 user memories and format as a system prompt block."""
        if not self.context.user_id:
            return ""
        try:
            from conflux.memory.manager import MemoryManager

            mm = MemoryManager()
            # Use the first user message as the search query; fall back to a generic prompt
            query = ""
            for msg in self.context.input_messages:
                if isinstance(msg, dict) and msg.get("role") == "user":
                    query = str(msg.get("content", ""))[:500]
                    break
            if not query:
                query = "general context"

            memories = await mm.search(
                query=query,
                scope="user",
                scope_id=self.context.user_id,
                limit=5,
                run_id=self.context.run_id,
                agent_id=self.config.agent_id,
                agent_name=self.config.name,
                user_id=self.context.user_id,
                tenant_id=self.context.tenant_id,
            )
            if not memories:
                return ""

            lines = ["## What I Know About This User"]
            for m in memories:
                lines.append(f"- **{m['key']}**: {m['value']}")
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("memory_injection_failed", run_id=self.context.run_id, error=str(exc))
            return ""

    async def _fetch_skills_block(self) -> str:
        """Inject level-0 skill list (name + description) for progressive disclosure."""
        try:
            from sqlalchemy import select

            from conflux.core.database import get_db_session
            from conflux.models.skill import Skill

            async with get_db_session() as db:
                stmt = (
                    select(Skill.name, Skill.slug, Skill.description)
                    .where(Skill.approval_status == "approved")
                    .order_by(Skill.name)
                    .limit(20)
                )
                result = await db.execute(stmt)
                skills = result.all()

            if not skills:
                return ""

            lines = ["## Available Skills", "Use the `skill_read` tool with a slug to load full instructions."]
            for name, slug, description in skills:
                lines.append(f"- **{name}** (`{slug}`): {description or 'No description'}")
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("skill_injection_failed", run_id=self.context.run_id, error=str(exc))
            return ""

    async def _fetch_wiki_block(self) -> str:
        if not getattr(self.config, "wiki_rag_enabled", True) or not self.context.user_id:
            return ""

        query = self._get_query_for_rag()
        if not query:
            return ""

        try:
            from sqlalchemy import select

            from conflux.models.user import User, UserViewAsSetting
            from conflux.wiki.search import search_for_agent

            async with get_db_session() as db:
                user_result = await db.execute(
                    select(User).where(User.id == self._coerce_uuid(self.context.user_id))
                )
                user = user_result.scalar_one_or_none()
                if user is None:
                    return ""

                view_as_user = False
                if user.is_admin:
                    view_as_user_result = await db.execute(
                        select(UserViewAsSetting.view_as_user).where(UserViewAsSetting.user_id == user.id)
                    )
                    view_as_user = bool(view_as_user_result.scalar_one_or_none())

                wiki_results = await search_for_agent(
                    db=db,
                    query=query,
                    user_id=user.id,
                    is_admin=user.is_admin,
                    top_k=5,
                    view_as_user=view_as_user,
                )

            if not wiki_results:
                return ""

            lines = ["## Relevant Wiki Pages"]
            for result in wiki_results:
                title = str(result.get("title") or "Untitled")
                snippet = str(result.get("snippet") or "").strip()
                lines.append(f"### {title}\n{snippet}" if snippet else f"### {title}")
            return "\n\n".join(lines)
        except Exception as exc:
            logger.warning("wiki_injection_failed", run_id=self.context.run_id, error=str(exc))
            return ""

    async def _update_run_status(
        self,
        status: str,
        output: dict[str, Any] | None = None,
        token_usage: dict[str, int] | None = None,
    ) -> None:
        """Persist a run status change to the database."""
        from sqlalchemy import update

        from conflux.models.agent import AgentRun

        now = datetime.now(timezone.utc)
        values: dict[str, Any] = {"status": status, "updated_at": now}
        if status == "running":
            values["started_at"] = now
        elif status in {"completed", "failed", "cancelled"}:
            values["completed_at"] = now
        if output is not None:
            values["output"] = output
        if token_usage is not None:
            values["token_usage"] = token_usage

        async with get_db_session() as db:
            await db.execute(
                update(AgentRun)
                .where(AgentRun.id == self._coerce_uuid(self.context.run_id))
                .values(**values)
            )

    async def _safe_update_run_status(
        self,
        status: str,
        output: dict[str, Any] | None = None,
        token_usage: dict[str, int] | None = None,
    ) -> None:
        try:
            await self._update_run_status(status, output=output, token_usage=token_usage)
        except Exception as exc:
            logger.warning(
                "Failed to update run status",
                run_id=self.context.run_id,
                status=status,
                error=str(exc),
            )

    async def _record_run_event(self, event_type: str, payload: dict[str, Any]) -> None:
        try:
            from conflux.models.agent import RunEvent

            self._event_sequence += 1
            async with get_db_session() as db:
                db.add(
                    RunEvent(
                        run_id=self._coerce_uuid(self.context.run_id),
                        event_type=event_type,
                        sequence=self._event_sequence,
                        payload=payload,
                    )
                )
        except Exception as exc:
            logger.warning(
                "Failed to persist run event",
                run_id=self.context.run_id,
                event_type=event_type,
                error=str(exc),
            )

        # Publish to Synapse stream (fire-and-forget)
        asyncio.ensure_future(self._publish_synapse_event(event_type, payload))

    async def _publish_synapse_event(self, event_type: str, payload: dict[str, Any]) -> None:
        type_map = {
            "done": "agent.completed",
            "error": "agent.failed",
            "tool_call": "tool.called",
            "tool_result": "tool.completed",
        }
        if event_type == "status":
            status_val = payload.get("status", "")
            if status_val == "running":
                synapse_type = "agent.started"
            elif status_val == "thinking":
                synapse_type = "agent.reasoning"
            else:
                return
        else:
            synapse_type = type_map.get(event_type)
            if not synapse_type:
                return

        await publish_event(
            synapse_type,
            payload,
            run_id=self.context.run_id,
            agent_id=str(self.config.agent_id) if self.config.agent_id else None,
            agent_name=self.config.name,
            user_id=str(self.context.user_id) if self.context.user_id else None,
            tenant_id=str(self.context.tenant_id) if self.context.tenant_id else None,
        )

    async def _record_trace_event(
        self,
        step: str,
        input_payload: dict[str, Any] | None = None,
        output_payload: dict[str, Any] | None = None,
    ) -> None:
        try:
            from conflux.models.learning import TraceEvent

            payload = {
                "iteration": self._iteration,
                "input": input_payload,
                "output": output_payload,
            }
            async with get_db_session() as db:
                db.add(
                    TraceEvent(
                        run_id=self._coerce_uuid(self.context.run_id),
                        event_type=step,
                        payload=payload,
                    )
                )
        except Exception as exc:
            logger.warning(
                "Failed to persist trace event",
                run_id=self.context.run_id,
                step=step,
                error=str(exc),
            )

    async def _finalize(self) -> None:
        """Post-run cleanup and reflection scheduling."""
        from conflux.learning.reflection import schedule_reflection

        if self._mcp_bridge is not None:
            try:
                await self._mcp_bridge.disconnect_all()
            except Exception as exc:
                logger.warning(
                    "Failed to disconnect MCP servers",
                    run_id=self.context.run_id,
                    error=str(exc),
                )
            self._mcp_bridge = None
            self._run_registry = None

        try:
            await schedule_reflection(run_id=self.context.run_id)
        except Exception as exc:
            logger.warning(
                "Failed to schedule reflection",
                run_id=self.context.run_id,
                error=str(exc),
            )

    @staticmethod
    def _parse_tool_args(raw_args: Any) -> dict[str, Any]:
        if raw_args is None:
            return {}
        if isinstance(raw_args, dict):
            return raw_args
        if isinstance(raw_args, str):
            try:
                parsed = json.loads(raw_args)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _coerce_uuid(value: str | None) -> str | UUID | None:
        if value is None:
            return None
        try:
            return UUID(str(value))
        except (TypeError, ValueError):
            return value
