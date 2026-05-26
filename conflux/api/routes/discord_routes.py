"""Discord bot REST API routes — guild config management."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.discord_guild import DiscordGuildConfig
from conflux.models.agent import Agent

router = APIRouter()


class GuildConfigUpdate(BaseModel):
    guild_name: str | None = None
    allowed_role_ids: list[str] | None = None
    notification_channel_id: str | None = None
    thread_mode: bool | None = None
    channel_agent_map: dict[str, str] | None = None
    default_agent_id: str | None = None


def _config_dict(config: DiscordGuildConfig) -> dict:
    return {
        "id": str(config.id),
        "guild_id": config.guild_id,
        "guild_name": config.guild_name,
        "allowed_role_ids": config.allowed_role_ids or [],
        "notification_channel_id": config.notification_channel_id,
        "thread_mode": config.thread_mode,
        "channel_agent_map": config.channel_agent_map or {},
        "default_agent_id": str(config.default_agent_id) if config.default_agent_id else None,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.get("/discord/status")
async def discord_status(_user: AdminUser) -> dict:
    """Return the Discord bot connection status."""
    try:
        from conflux.channels.discord_bot import _bot_instance
        if _bot_instance and not _bot_instance.is_closed():
            bot_user = _bot_instance.user
            return {
                "connected": True,
                "bot_name": str(bot_user) if bot_user else "Unknown",
                "bot_id": str(bot_user.id) if bot_user else None,
                "guild_count": len(_bot_instance.guilds),
                "latency_ms": round(_bot_instance.latency * 1000, 1),
            }
    except Exception:
        pass
    return {"connected": False, "bot_name": None, "bot_id": None, "guild_count": 0, "latency_ms": None}


@router.get("/discord/guilds")
async def list_guilds(_user: AdminUser, db: DB) -> list[dict]:
    """List all known guild configurations."""
    configs = (await db.scalars(select(DiscordGuildConfig).order_by(DiscordGuildConfig.guild_name))).all()
    return [_config_dict(c) for c in configs]


@router.get("/discord/guilds/{guild_id}")
async def get_guild(guild_id: str, _user: AdminUser, db: DB) -> dict:
    config = await db.scalar(select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == guild_id))
    if not config:
        raise HTTPException(status_code=404, detail="Guild config not found")
    return _config_dict(config)


@router.put("/discord/guilds/{guild_id}")
async def upsert_guild(guild_id: str, body: GuildConfigUpdate, _user: AdminUser, db: DB) -> dict:
    """Create or update a guild configuration."""
    config = await db.scalar(select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == guild_id))
    if not config:
        config = DiscordGuildConfig(guild_id=guild_id, guild_name=body.guild_name or guild_id)
        db.add(config)

    if body.guild_name is not None:
        config.guild_name = body.guild_name
    if body.allowed_role_ids is not None:
        config.allowed_role_ids = body.allowed_role_ids
    if body.notification_channel_id is not None:
        config.notification_channel_id = body.notification_channel_id or None
    if body.thread_mode is not None:
        config.thread_mode = body.thread_mode
    if body.channel_agent_map is not None:
        config.channel_agent_map = body.channel_agent_map
    if body.default_agent_id is not None:
        # Validate agent exists
        if body.default_agent_id:
            agent = await db.get(Agent, UUID(body.default_agent_id))
            if not agent:
                raise HTTPException(status_code=404, detail="Agent not found")
            config.default_agent_id = UUID(body.default_agent_id)
        else:
            config.default_agent_id = None

    await db.commit()
    await db.refresh(config)
    return _config_dict(config)


@router.delete("/discord/guilds/{guild_id}", status_code=204)
async def delete_guild(guild_id: str, _user: AdminUser, db: DB) -> None:
    config = await db.scalar(select(DiscordGuildConfig).where(DiscordGuildConfig.guild_id == guild_id))
    if not config:
        raise HTTPException(status_code=404, detail="Guild config not found")
    await db.delete(config)
    await db.commit()
