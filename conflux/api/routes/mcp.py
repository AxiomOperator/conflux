"""MCP server management routes."""
from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.mcp import AgentMcpServer, McpServer

logger = structlog.get_logger(__name__)

router = APIRouter()

_VALID_TRANSPORTS = {'stdio', 'sse'}
_VALID_RISK_LEVELS = {'safe', 'moderate', 'destructive'}


class McpServerCreate(BaseModel):
    name: str
    description: str | None = None
    transport: str = 'stdio'
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    risk_level: str = 'moderate'
    is_enabled: bool = True


class McpServerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    transport: str | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    risk_level: str | None = None
    is_enabled: bool | None = None


def _validate_server_config(transport: str, command: str | None, url: str | None, risk_level: str) -> None:
    if transport not in _VALID_TRANSPORTS:
        raise HTTPException(status_code=422, detail="transport must be 'stdio' or 'sse'")
    if transport == 'stdio' and not command:
        raise HTTPException(status_code=422, detail='command is required for stdio transport')
    if transport == 'sse' and not url:
        raise HTTPException(status_code=422, detail='url is required for sse transport')
    if risk_level not in _VALID_RISK_LEVELS:
        raise HTTPException(status_code=422, detail='risk_level must be safe, moderate, or destructive')


def _server_dict(server: McpServer) -> dict:
    return {
        'id': str(server.id),
        'name': server.name,
        'description': server.description,
        'transport': server.transport,
        'command': server.command,
        'args': server.args or [],
        'env': server.env or {},
        'url': server.url,
        'headers': server.headers or {},
        'risk_level': server.risk_level,
        'is_enabled': server.is_enabled,
        'created_at': server.created_at.isoformat() if server.created_at else None,
        'updated_at': server.updated_at.isoformat() if server.updated_at else None,
    }


@router.get('/servers')
async def list_mcp_servers(db: DB, user: CurrentUser):
    """List all MCP servers."""
    result = await db.execute(select(McpServer).order_by(McpServer.name))
    return [_server_dict(server) for server in result.scalars().all()]


@router.post('/servers', status_code=201)
async def create_mcp_server(body: McpServerCreate, db: DB, user: AdminUser):
    """Create a new MCP server configuration. Admin only."""
    _validate_server_config(body.transport, body.command, body.url, body.risk_level)

    existing = await db.execute(select(McpServer).where(McpServer.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"MCP server '{body.name}' already exists")

    server = McpServer(
        name=body.name,
        description=body.description,
        transport=body.transport,
        command=body.command,
        args=body.args,
        env=body.env,
        url=body.url,
        headers=body.headers,
        risk_level=body.risk_level,
        is_enabled=body.is_enabled,
        created_by=UUID(user.user_id),
    )
    db.add(server)
    await db.commit()
    await db.refresh(server)
    logger.info('MCP server created', server_id=str(server.id), name=server.name, user=user.user_id)
    return _server_dict(server)


@router.get('/servers/{server_id}')
async def get_mcp_server(server_id: UUID, db: DB, user: CurrentUser):
    """Get a single MCP server by ID."""
    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail='MCP server not found')
    return _server_dict(server)


@router.put('/servers/{server_id}')
async def update_mcp_server(server_id: UUID, body: McpServerUpdate, db: DB, user: AdminUser):
    """Update an MCP server. Admin only."""
    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail='MCP server not found')

    if body.name is not None and body.name != server.name:
        existing = await db.execute(
            select(McpServer).where(McpServer.name == body.name, McpServer.id != server_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"MCP server '{body.name}' already exists")
        server.name = body.name
    if body.description is not None:
        server.description = body.description
    if body.transport is not None:
        server.transport = body.transport
    if body.command is not None:
        server.command = body.command
    if body.args is not None:
        server.args = body.args
    if body.env is not None:
        server.env = body.env
    if body.url is not None:
        server.url = body.url
    if body.headers is not None:
        server.headers = body.headers
    if body.risk_level is not None:
        server.risk_level = body.risk_level
    if body.is_enabled is not None:
        server.is_enabled = body.is_enabled

    _validate_server_config(server.transport, server.command, server.url, server.risk_level)

    await db.commit()
    await db.refresh(server)
    logger.info('MCP server updated', server_id=str(server.id), name=server.name, user=user.user_id)
    return _server_dict(server)


@router.delete('/servers/{server_id}', status_code=204)
async def delete_mcp_server(server_id: UUID, db: DB, user: AdminUser):
    """Delete an MCP server. Admin only."""
    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail='MCP server not found')
    await db.delete(server)
    await db.commit()
    logger.info('MCP server deleted', server_id=str(server_id), user=user.user_id)


@router.post('/servers/{server_id}/test')
async def test_mcp_server(server_id: UUID, db: DB, user: AdminUser):
    """Test connectivity to an MCP server and return its tool list. Admin only."""
    from conflux.integrations.mcp import McpClientError, probe_mcp_server

    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail='MCP server not found')

    try:
        tools = await probe_mcp_server(
            name=server.name,
            transport=server.transport,
            command=server.command,
            args=server.args or [],
            env=server.env or {},
            url=server.url,
            headers=server.headers or {},
            timeout=15.0,
        )
        return {'status': 'connected', 'tools': tools, 'tool_count': len(tools)}
    except McpClientError as exc:
        return {'status': 'error', 'error': str(exc), 'tools': [], 'tool_count': 0}
    except Exception as exc:
        return {'status': 'error', 'error': f'Unexpected error: {exc}', 'tools': [], 'tool_count': 0}


@router.get('/agents/{agent_id}/servers')
async def list_agent_mcp_servers(agent_id: UUID, db: DB, user: CurrentUser):
    """List MCP servers assigned to an agent."""
    result = await db.execute(
        select(McpServer)
        .join(AgentMcpServer, AgentMcpServer.mcp_server_id == McpServer.id)
        .where(AgentMcpServer.agent_id == agent_id)
        .order_by(McpServer.name)
    )
    return [_server_dict(server) for server in result.scalars().all()]


@router.post('/agents/{agent_id}/servers', status_code=201)
async def assign_mcp_server_to_agent(
    agent_id: UUID,
    db: DB,
    user: AdminUser,
    body: dict,
):
    """Assign an MCP server to an agent. Admin only. Body: {\"mcp_server_id\": \"uuid\"}"""
    mcp_server_id_str = body.get('mcp_server_id')
    if not mcp_server_id_str:
        raise HTTPException(status_code=422, detail='mcp_server_id is required')
    try:
        mcp_server_id = UUID(str(mcp_server_id_str))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='mcp_server_id must be a valid UUID') from exc

    server_result = await db.execute(select(McpServer).where(McpServer.id == mcp_server_id))
    if not server_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail='MCP server not found')

    existing = await db.execute(
        select(AgentMcpServer).where(
            AgentMcpServer.agent_id == agent_id,
            AgentMcpServer.mcp_server_id == mcp_server_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail='MCP server already assigned to this agent')

    assoc = AgentMcpServer(agent_id=agent_id, mcp_server_id=mcp_server_id)
    db.add(assoc)
    await db.commit()
    logger.info('MCP server assigned to agent', agent_id=str(agent_id), mcp_server_id=str(mcp_server_id), user=user.user_id)
    return {'agent_id': str(agent_id), 'mcp_server_id': str(mcp_server_id)}


@router.delete('/agents/{agent_id}/servers/{mcp_server_id}', status_code=204)
async def unassign_mcp_server_from_agent(
    agent_id: UUID,
    mcp_server_id: UUID,
    db: DB,
    user: AdminUser,
):
    """Remove an MCP server assignment from an agent. Admin only."""
    result = await db.execute(
        select(AgentMcpServer).where(
            AgentMcpServer.agent_id == agent_id,
            AgentMcpServer.mcp_server_id == mcp_server_id,
        )
    )
    assoc = result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(status_code=404, detail='Assignment not found')
    await db.delete(assoc)
    await db.commit()
    logger.info('MCP server unassigned from agent', agent_id=str(agent_id), mcp_server_id=str(mcp_server_id), user=user.user_id)
