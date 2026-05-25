"""MCP tool bridge — connects MCP servers and registers their tools per agent run."""
from __future__ import annotations

import asyncio
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.integrations.mcp import McpClientError, McpServerConnection
from conflux.models.mcp import AgentMcpServer, McpServer
from conflux.tools.registry import ToolDefinition, ToolRegistry

logger = structlog.get_logger(__name__)


class RunScopedRegistry(ToolRegistry):
    """A per-run ToolRegistry that layers MCP tools on top of the global registry.

    The global registry is read for all non-MCP tools. MCP tools are added
    to this instance only, so they don't leak between runs.
    """

    def __init__(self, base: ToolRegistry) -> None:
        super().__init__()
        self._base = base
        self._mcp_tools: set[str] = set()
        # Copy state from base
        self._tools = dict(base._tools)
        self._disabled = set(base._disabled)
        self._custom_tools = set(base._custom_tools)
        self._description_overrides = dict(base._description_overrides)
        self._risk_overrides = dict(base._risk_overrides)
        self._approval_overrides = dict(base._approval_overrides)

    def register(self, tool: ToolDefinition) -> None:
        super().register(tool)
        if tool.name not in self._base._tools:
            self._mcp_tools.add(tool.name)

    def get_tools_for_agent(self, allowlist: list[str]) -> list[dict[str, Any]]:
        if not allowlist or not self._mcp_tools:
            return super().get_tools_for_agent(allowlist)
        merged_allowlist = list(dict.fromkeys([*allowlist, *self._mcp_tools]))
        return super().get_tools_for_agent(merged_allowlist)


class McpBridge:
    """Manages MCP server connections for a single agent run.

    Usage:
        bridge = McpBridge()
        registry = await bridge.load_for_agent(agent_id, db, base_registry)
        tools = registry.get_tools_for_agent(allowlist)
        result = await registry.execute(tool_name, args, context)
        await bridge.disconnect_all()
    """

    def __init__(self) -> None:
        self._connections: list[McpServerConnection] = []

    async def load_for_agent(
        self,
        agent_id: str,
        db: AsyncSession,
        base_registry: ToolRegistry,
    ) -> RunScopedRegistry:
        """Load MCP servers assigned to agent_id, connect them, register their tools.

        Returns a RunScopedRegistry with global + MCP tools.
        Failures are logged but do not prevent the run from starting.
        """
        from uuid import UUID

        scoped = RunScopedRegistry(base_registry)

        try:
            agent_uuid = UUID(str(agent_id))
        except (TypeError, ValueError):
            logger.warning("Invalid agent_id for MCP bridge", agent_id=agent_id)
            return scoped

        result = await db.execute(
            select(McpServer)
            .join(AgentMcpServer, AgentMcpServer.mcp_server_id == McpServer.id)
            .where(
                AgentMcpServer.agent_id == agent_uuid,
                McpServer.is_enabled.is_(True),
            )
        )
        servers = result.scalars().all()

        if not servers:
            return scoped

        logger.info("Loading MCP servers for agent", agent_id=agent_id, count=len(servers))

        connect_tasks = [self._connect_and_register(server, scoped) for server in servers]
        await asyncio.gather(*connect_tasks, return_exceptions=True)

        return scoped

    async def _connect_and_register(self, server: McpServer, registry: RunScopedRegistry) -> None:
        """Connect to one MCP server and register its tools. Non-fatal on error."""
        conn = McpServerConnection(
            name=server.name,
            transport=server.transport,
            command=server.command,
            args=server.args or [],
            env=server.env or {},
            url=server.url,
            headers=server.headers or {},
        )
        try:
            await asyncio.wait_for(conn.connect(), timeout=10.0)
            self._connections.append(conn)
            _register_mcp_tools(conn, registry, server.risk_level)
            logger.info(
                "MCP server ready",
                server=server.name,
                tools=len(conn.tools),
            )
        except McpClientError as exc:
            logger.warning("MCP server failed to connect", server=server.name, error=str(exc))
        except asyncio.TimeoutError:
            logger.warning("MCP server connection timed out", server=server.name)
        except Exception as exc:
            logger.warning("MCP server unexpected error", server=server.name, error=str(exc))

    async def disconnect_all(self) -> None:
        """Disconnect all open MCP server connections."""
        tasks = [conn.disconnect() for conn in self._connections]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._connections.clear()


def _register_mcp_tools(
    conn: McpServerConnection,
    registry: RunScopedRegistry,
    risk_level: str,
) -> None:
    """Register all tools from a connected MCP server into the registry."""
    for tool_def in conn.get_tool_definitions():
        tool_name = tool_def["name"]
        original_name = tool_def["original_name"]
        server_name = conn.name

        async def _mcp_executor(
            args: dict[str, Any],
            context: Any,
            _conn: McpServerConnection = conn,
            _original: str = original_name,
            _server: str = server_name,
        ) -> Any:
            try:
                return await _conn.call_tool(_original, args)
            except McpClientError as exc:
                logger.error(
                    "MCP tool call failed",
                    server=_server,
                    tool=_original,
                    error=str(exc),
                )
                return {"error": str(exc)}

        registry.register(
            ToolDefinition(
                name=tool_name,
                description=tool_def["description"],
                parameters=tool_def["parameters"],
                risk_level=risk_level,
                requires_approval=False,
                fn=_mcp_executor,
            )
        )
        logger.debug("MCP tool registered", name=tool_name)
