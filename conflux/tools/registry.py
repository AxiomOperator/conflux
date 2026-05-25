"""Tool registry and execution engine."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
import time
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

ToolCallable = Callable[[dict[str, Any], "RunContext"], Awaitable[Any]]


@dataclass(slots=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    risk_level: str
    fn: ToolCallable
    requires_approval: bool = False


class ToolRegistry:
    """Central registry for all agent tools."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        # DB-sourced overrides for built-in tools
        self._disabled: set[str] = set()
        self._custom_tools: set[str] = set()
        self._description_overrides: dict[str, str] = {}
        self._risk_overrides: dict[str, str] = {}
        self._approval_overrides: dict[str, bool] = {}

    def register(self, tool: ToolDefinition) -> None:
        if tool.risk_level not in {"safe", "moderate", "destructive"}:
            raise ValueError(f"Invalid risk level: {tool.risk_level}")
        self._tools[tool.name] = tool
        logger.debug("Tool registered", name=tool.name, risk=tool.risk_level)

    def tool(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        risk_level: str = "safe",
        requires_approval: bool = False,
    ) -> Callable[[ToolCallable], ToolCallable]:
        """Decorator to register a function as a tool."""

        def decorator(fn: ToolCallable) -> ToolCallable:
            self.register(
                ToolDefinition(
                    name=name,
                    description=description,
                    parameters=parameters,
                    risk_level=risk_level,
                    requires_approval=requires_approval,
                    fn=fn,
                )
            )
            return fn

        return decorator

    def get_tools_for_agent(self, allowlist: list[str]) -> list[dict[str, Any]]:
        """
        Return tool definitions in OpenAI function-calling format.
        If allowlist is empty, return all tools. Disabled tools are always excluded.
        """
        tools: list[dict[str, Any]] = []
        for name, defn in self._tools.items():
            if name in self._disabled:
                continue
            if allowlist and name not in allowlist:
                continue
            description = self._description_overrides.get(name, defn.description)
            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": defn.name,
                        "description": description,
                        "parameters": defn.parameters,
                    },
                }
            )
        return tools

    async def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        context: "RunContext",
    ) -> Any:
        """Execute a tool call while respecting DATA_GUARD_ENABLED."""
        from conflux.core.config import get_settings
        from conflux.services.audit import _truncate, log_audit_event

        settings = get_settings()

        if tool_name not in self._tools:
            error = {"error": f"Unknown tool: {tool_name}"}
            log_audit_event(
                event_type="error",
                agent_run_id=str(context.run_id) if context.run_id else None,
                user_id=str(context.user_id) if context.user_id else None,
                session_id=str(context.session_id) if context.session_id else None,
                tool_name=tool_name,
                args_preview=_truncate(args),
                result_preview=None,
                error_message=error["error"],
                duration_ms=0.0,
            )
            return error

        defn = self._tools[tool_name]

        if settings.data_guard_enabled and defn.risk_level == "destructive":
            logger.warning("Tool blocked by data guard", tool=tool_name, run_id=context.run_id)
            error = {"error": f"Tool '{tool_name}' is blocked (DATA_GUARD_ENABLED=true)"}
            log_audit_event(
                event_type="error",
                agent_run_id=str(context.run_id) if context.run_id else None,
                user_id=str(context.user_id) if context.user_id else None,
                session_id=str(context.session_id) if context.session_id else None,
                tool_name=tool_name,
                args_preview=_truncate(args),
                result_preview=None,
                error_message=error["error"],
                duration_ms=0.0,
            )
            return error

        start = time.monotonic()
        try:
            result = await defn.fn(args, context)
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            logger.info("Tool executed", tool=tool_name, run_id=context.run_id)

            event_type = "shell_command" if tool_name == "shell_exec" else "tool_call"
            shell_failed = isinstance(result, dict) and result.get("returncode", 0) != 0
            is_error = isinstance(result, dict) and ("error" in result or shell_failed)
            if is_error and tool_name != "shell_exec":
                event_type = "error"

            error_message = None
            if isinstance(result, dict):
                error_message = result.get("error") or (result.get("stderr") if shell_failed else None)

            log_audit_event(
                event_type=event_type,
                agent_run_id=str(context.run_id) if context.run_id else None,
                user_id=str(context.user_id) if context.user_id else None,
                session_id=str(context.session_id) if context.session_id else None,
                tool_name=tool_name,
                args_preview=_truncate(args),
                result_preview=_truncate(result),
                error_message=error_message,
                duration_ms=duration_ms,
            )
            return result
        except Exception as exc:  # pragma: no cover - defensive logging
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            logger.exception("Tool execution failed", tool=tool_name, run_id=context.run_id)
            log_audit_event(
                event_type="error",
                agent_run_id=str(context.run_id) if context.run_id else None,
                user_id=str(context.user_id) if context.user_id else None,
                session_id=str(context.session_id) if context.session_id else None,
                tool_name=tool_name,
                args_preview=_truncate(args) if args else None,
                result_preview=None,
                error_message=str(exc),
                duration_ms=duration_ms,
            )
            return {"error": str(exc)}

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": self._description_overrides.get(tool.name, tool.description),
                "risk_level": self._risk_overrides.get(tool.name, tool.risk_level),
                "requires_approval": self._approval_overrides.get(tool.name, tool.requires_approval),
                "is_enabled": tool.name not in self._disabled,
                "is_builtin": tool.name not in self._custom_tools,
                "parameters": tool.parameters,
            }
            for tool in self._tools.values()
        ]

    def apply_db_configs(self, configs: list[dict[str, Any]]) -> None:
        """Apply DB-stored tool configurations.

        For built-in tools: stores overrides for description, risk_level,
        requires_approval, and is_enabled without mutating the original definition.
        For custom webhook tools: registers them as callable tools.
        """
        for cfg in configs:
            name = cfg["name"]
            if not cfg.get("is_enabled", True):
                self._disabled.add(name)
            elif name in self._disabled:
                self._disabled.discard(name)

            if cfg.get("is_builtin", True):
                if cfg.get("description_override"):
                    self._description_overrides[name] = cfg["description_override"]
                if cfg.get("risk_level"):
                    self._risk_overrides[name] = cfg["risk_level"]
                if "requires_approval" in cfg:
                    self._approval_overrides[name] = cfg["requires_approval"]
            else:
                # Custom webhook tool — register if not already present
                self._register_webhook_tool(cfg)

    def _register_webhook_tool(self, cfg: dict[str, Any]) -> None:
        """Register a custom HTTP webhook tool."""
        name = cfg["name"]
        endpoint_url = cfg.get("endpoint_url", "")
        http_method = (cfg.get("http_method") or "POST").upper()
        custom_headers = cfg.get("custom_headers") or {}
        parameters = cfg.get("custom_parameters") or {"type": "object", "properties": {}}

        async def _webhook_executor(args: dict[str, Any], context: Any) -> Any:
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.request(
                        http_method,
                        endpoint_url,
                        json=args,
                        headers=custom_headers,
                    )
                    resp.raise_for_status()
                    return resp.json()
            except Exception as exc:
                return {"error": str(exc)}

        # Mark the executor as custom so list_tools can identify it
        _webhook_executor._is_custom = True  # type: ignore[attr-defined]

        defn = ToolDefinition(
            name=name,
            description=cfg.get("description_override") or cfg.get("description") or name,
            parameters=parameters,
            risk_level=cfg.get("risk_level", "moderate"),
            requires_approval=cfg.get("requires_approval", False),
            fn=_webhook_executor,
        )
        self._tools[name] = defn
        self._custom_tools.add(name)
        logger.debug("Custom webhook tool registered", name=name, endpoint=endpoint_url)


_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
        _load_builtin_tools(_registry)
    return _registry


def _load_builtin_tools(registry: ToolRegistry) -> None:
    """Load all built-in tools into the registry."""
    from conflux.tools.builtins import (
        agentmail,
        colony,
        fetch,
        memory,
        shell,
        skill,
        skills_marketplace,
        web_search,
        weather,
    )

    agentmail.register(registry)
    web_search.register(registry)
    weather.register(registry)
    memory.register(registry)
    skill.register(registry)
    skills_marketplace.register(registry)
    shell.register(registry)
    fetch.register(registry)
    colony.register(registry)
