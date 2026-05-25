"""MCP (Model Context Protocol) client for connecting to external tool servers."""
from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager
from typing import Any

import structlog
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.types import Tool

logger = structlog.get_logger(__name__)


def slugify(text: str) -> str:
    """Convert text to a safe tool name segment."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "_", text)
    return text.strip("_")


class McpClientError(Exception):
    """Raised when MCP client operations fail."""


class McpServerConnection:
    """Manages a live connection to one MCP server."""

    def __init__(
        self,
        name: str,
        transport: str,
        *,
        # stdio params
        command: str | None = None,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        # sse params
        url: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        self.transport = transport
        self.command = command
        self.args = args or []
        self.env = env or {}
        self.url = url
        self.headers = headers or {}
        self._session: ClientSession | None = None
        self._tools: list[Tool] = []
        self._context_stack: Any = None

    @property
    def slug(self) -> str:
        return slugify(self.name)

    @property
    def tools(self) -> list[Tool]:
        return self._tools

    async def connect(self) -> None:
        """Open the transport and initialize the MCP session."""
        try:
            if self.transport == "stdio":
                if not self.command:
                    raise McpClientError(
                        f"MCP server '{self.name}' requires a command for stdio transport"
                    )
                params = StdioServerParameters(
                    command=self.command,
                    args=self.args,
                    env=self.env or None,
                )
                cm = stdio_client(params)
            elif self.transport == "sse":
                if not self.url:
                    raise McpClientError(
                        f"MCP server '{self.name}' requires a URL for SSE transport"
                    )
                cm = sse_client(self.url, headers=self.headers or None)
            else:
                raise McpClientError(f"Unknown MCP transport: {self.transport}")

            self._context_stack = cm
            read, write = await cm.__aenter__()
            self._session = ClientSession(read, write)
            await self._session.__aenter__()
            await self._session.initialize()
            tools_result = await self._session.list_tools()
            self._tools = tools_result.tools
            logger.info(
                "MCP server connected",
                server=self.name,
                transport=self.transport,
                tools=len(self._tools),
            )
        except McpClientError:
            raise
        except Exception as exc:
            raise McpClientError(f"Failed to connect to MCP server '{self.name}': {exc}") from exc

    async def disconnect(self) -> None:
        """Close the session and transport."""
        try:
            if self._session is not None:
                try:
                    await self._session.__aexit__(None, None, None)
                except Exception:
                    pass
                self._session = None
            if self._context_stack is not None:
                try:
                    await self._context_stack.__aexit__(None, None, None)
                except Exception:
                    pass
                self._context_stack = None
        except Exception as exc:
            logger.warning("Error disconnecting MCP server", server=self.name, error=str(exc))

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on the MCP server and return the result."""
        if self._session is None:
            raise McpClientError(f"MCP server '{self.name}' is not connected")
        try:
            result = await self._session.call_tool(tool_name, arguments=arguments)
            if hasattr(result, "content") and result.content:
                parts = []
                for item in result.content:
                    if hasattr(item, "text"):
                        parts.append(item.text)
                    elif hasattr(item, "data"):
                        parts.append(str(item.data))
                    else:
                        parts.append(str(item))
                return "\n".join(parts) if len(parts) > 1 else (parts[0] if parts else "")
            return str(result)
        except McpClientError:
            raise
        except Exception as exc:
            raise McpClientError(
                f"Tool call '{tool_name}' on server '{self.name}' failed: {exc}"
            ) from exc

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return tools in OpenAI function-calling format with prefixed names."""
        defs = []
        for tool in self._tools:
            params: dict[str, Any] = {"type": "object", "properties": {}}
            if hasattr(tool, "inputSchema") and tool.inputSchema:
                schema = tool.inputSchema
                if hasattr(schema, "model_dump"):
                    params = schema.model_dump(exclude_none=True)
                elif isinstance(schema, dict):
                    params = schema
            prefixed_name = f"mcp__{self.slug}__{tool.name}"
            defs.append(
                {
                    "name": prefixed_name,
                    "original_name": tool.name,
                    "server_name": self.name,
                    "server_slug": self.slug,
                    "description": tool.description
                    or f"Tool '{tool.name}' from MCP server '{self.name}'",
                    "parameters": params,
                }
            )
        return defs


@asynccontextmanager
async def connected_mcp_server(
    name: str,
    transport: str,
    **kwargs: Any,
):
    """Async context manager that yields a connected McpServerConnection."""
    conn = McpServerConnection(name=name, transport=transport, **kwargs)
    try:
        await conn.connect()
        yield conn
    finally:
        await conn.disconnect()


async def probe_mcp_server(
    name: str,
    transport: str,
    *,
    command: str | None = None,
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    url: str | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> list[dict[str, Any]]:
    """Connect to an MCP server, list its tools, then disconnect. Returns tool definitions.

    Used by the admin test endpoint to verify a server config before saving.
    Raises McpClientError if the connection fails.
    """
    conn = McpServerConnection(
        name=name,
        transport=transport,
        command=command,
        args=args,
        env=env,
        url=url,
        headers=headers,
    )
    try:
        await asyncio.wait_for(conn.connect(), timeout=timeout)
        return conn.get_tool_definitions()
    finally:
        await conn.disconnect()
