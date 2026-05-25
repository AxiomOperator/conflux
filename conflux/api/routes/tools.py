"""Tool configuration routes — admin CRUD for built-in overrides and custom webhook tools."""
from __future__ import annotations

import uuid

from sqlalchemy import select

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.tool import ToolConfig
from conflux.tools.registry import get_tool_registry

router = APIRouter()


class ToolExecuteRequest(BaseModel):
    args: dict = Field(default_factory=dict)


@router.post("/{name}/execute")
async def execute_tool(name: str, body: ToolExecuteRequest, user: CurrentUser):
    """Execute a built-in tool by name. Used by the playground to call tools on behalf of the LLM."""
    from conflux.agents.base import RunContext

    registry = get_tool_registry()
    if name not in registry._tools:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    context = RunContext(
        run_id=str(uuid.uuid4()),
        user_id=str(user.user_id) if user.user_id else None,
        session_id=None,
        tenant_id=str(user.tenant_id) if user.tenant_id else None,
        project_id=None,
        input_messages=[],
    )

    try:
        result = await registry.execute(name, body.args, context)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"result": result}


def _config_dict(cfg: ToolConfig, registry_tool: dict | None = None) -> dict:
    """Merge DB config with live registry info."""
    base: dict = {
        "name": cfg.name,
        "description": cfg.description_override or (registry_tool or {}).get("description", ""),
        "description_override": cfg.description_override,
        "risk_level": cfg.risk_level,
        "requires_approval": cfg.requires_approval,
        "is_enabled": cfg.is_enabled,
        "is_builtin": cfg.is_builtin,
        "endpoint_url": cfg.endpoint_url,
        "http_method": cfg.http_method,
        "custom_headers": cfg.custom_headers,
        "parameters": cfg.custom_parameters or (registry_tool or {}).get("parameters"),
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
    }
    # Inject original description from registry for built-ins
    if registry_tool and cfg.is_builtin:
        base["original_description"] = registry_tool.get("description", "")
    return base


@router.get("")
async def list_tools(db: DB, user: AdminUser):
    """Return all tools — built-ins from registry merged with DB configs, plus custom tools."""
    registry = get_tool_registry()
    live_tools = {t["name"]: t for t in registry.list_tools()}

    # Load all DB configs
    result = await db.execute(select(ToolConfig).order_by(ToolConfig.name))
    db_configs = {cfg.name: cfg for cfg in result.scalars().all()}

    tools = []
    # Built-ins first (from registry, with any DB overrides applied)
    for name, live in live_tools.items():
        cfg = db_configs.get(name)
        if cfg:
            tools.append(_config_dict(cfg, live))
        else:
            # No DB record yet — return the live defaults
            tools.append({
                "name": live["name"],
                "description": live["description"],
                "description_override": None,
                "risk_level": live["risk_level"],
                "requires_approval": live["requires_approval"],
                "is_enabled": live["is_enabled"],
                "is_builtin": live["is_builtin"],
                "endpoint_url": None,
                "http_method": None,
                "custom_headers": None,
                "parameters": live.get("parameters"),
                "original_description": live["description"] if not live.get("is_builtin", True) else live["description"],
                "created_at": None,
                "updated_at": None,
            })

    # Custom tools in DB that aren't in the live registry (edge case after restart)
    for name, cfg in db_configs.items():
        if not cfg.is_builtin and name not in live_tools:
            tools.append(_config_dict(cfg))

    return {"tools": tools}


class ToolUpdate(BaseModel):
    description_override: str | None = None
    risk_level: str | None = None
    requires_approval: bool | None = None
    is_enabled: bool | None = None


class ToolCreate(BaseModel):
    name: str
    description: str
    risk_level: str = "moderate"
    requires_approval: bool = False
    endpoint_url: str
    http_method: str = "POST"
    custom_headers: dict | None = None
    custom_parameters: dict | None = None


@router.patch("/{name}")
async def update_tool(name: str, body: ToolUpdate, db: DB, user: AdminUser):
    """Create-or-update the DB config for a tool (built-in override or custom tool settings)."""
    result = await db.execute(select(ToolConfig).where(ToolConfig.name == name))
    cfg = result.scalar_one_or_none()

    registry = get_tool_registry()
    live_tools = {t["name"]: t for t in registry.list_tools()}

    if cfg is None:
        # First time overriding a built-in
        if name not in live_tools and not live_tools.get(name, {}).get("is_builtin", True):
            raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")
        is_builtin = live_tools.get(name, {}).get("is_builtin", True)
        cfg = ToolConfig(
            name=name,
            is_builtin=is_builtin,
            risk_level=live_tools.get(name, {}).get("risk_level", "safe"),
        )
        db.add(cfg)

    if body.description_override is not None:
        cfg.description_override = body.description_override or None
    if body.risk_level is not None:
        if body.risk_level not in {"safe", "moderate", "destructive"}:
            raise HTTPException(status_code=422, detail="risk_level must be safe, moderate, or destructive")
        cfg.risk_level = body.risk_level
    if body.requires_approval is not None:
        cfg.requires_approval = body.requires_approval
    if body.is_enabled is not None:
        cfg.is_enabled = body.is_enabled

    await db.flush()

    # Re-apply DB configs to the live registry
    result2 = await db.execute(select(ToolConfig))
    all_configs = [
        {
            "name": c.name,
            "is_builtin": c.is_builtin,
            "is_enabled": c.is_enabled,
            "description_override": c.description_override,
            "risk_level": c.risk_level,
            "requires_approval": c.requires_approval,
            "endpoint_url": c.endpoint_url,
            "http_method": c.http_method,
            "custom_headers": c.custom_headers,
            "custom_parameters": c.custom_parameters,
        }
        for c in result2.scalars().all()
    ]
    registry.apply_db_configs(all_configs)

    return {"name": name, "updated": True}


@router.post("")
async def create_tool(body: ToolCreate, db: DB, user: AdminUser):
    """Create a new custom webhook tool."""
    result = await db.execute(select(ToolConfig).where(ToolConfig.name == body.name))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Tool '{body.name}' already exists")

    if body.risk_level not in {"safe", "moderate", "destructive"}:
        raise HTTPException(status_code=422, detail="risk_level must be safe, moderate, or destructive")

    cfg = ToolConfig(
        name=body.name,
        description_override=body.description,
        risk_level=body.risk_level,
        requires_approval=body.requires_approval,
        is_enabled=True,
        is_builtin=False,
        endpoint_url=body.endpoint_url,
        http_method=body.http_method.upper(),
        custom_headers=body.custom_headers,
        custom_parameters=body.custom_parameters,
    )
    db.add(cfg)
    await db.flush()

    # Register the new custom tool in the live registry
    get_tool_registry().apply_db_configs([{
        "name": cfg.name,
        "is_builtin": False,
        "is_enabled": True,
        "description_override": cfg.description_override,
        "risk_level": cfg.risk_level,
        "requires_approval": cfg.requires_approval,
        "endpoint_url": cfg.endpoint_url,
        "http_method": cfg.http_method,
        "custom_headers": cfg.custom_headers,
        "custom_parameters": cfg.custom_parameters,
    }])

    return {"name": cfg.name, "created": True}


@router.delete("/{name}")
async def delete_tool(name: str, db: DB, user: AdminUser):
    """Delete a custom tool. Built-in tools cannot be deleted (only disabled)."""
    result = await db.execute(select(ToolConfig).where(ToolConfig.name == name))
    cfg = result.scalar_one_or_none()

    if cfg is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found in database")
    if cfg.is_builtin:
        raise HTTPException(status_code=400, detail="Built-in tools cannot be deleted. Use PATCH to disable them.")

    await db.delete(cfg)

    # Unregister from live registry
    registry = get_tool_registry()
    registry._tools.pop(name, None)
    registry._custom_tools.discard(name)
    registry._disabled.discard(name)

    return {"name": name, "deleted": True}
