"""Discord guild (server) configuration model."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin


class DiscordGuildConfig(UUIDMixin, TimestampMixin, Base):
    """Per-Discord-server (guild) configuration.

    Stored once per guild. Controls which roles can use the bot, how
    conversations are threaded, which agent handles each channel, and
    where proactive notifications are posted.
    """

    __tablename__ = "discord_guild_configs"

    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    guild_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")

    # List of Discord role snowflake IDs (as strings) that may use the bot.
    # Empty list = all server members are allowed.
    allowed_role_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="'[]'::jsonb")

    # Discord channel snowflake ID to post proactive notifications into.
    notification_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # When True each conversation spawns a Discord thread; when False bot replies in-channel.
    thread_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    # Maps Discord channel snowflake IDs (str) → Conflux agent UUID (str).
    # e.g. {"123456789": "agent-uuid-here"}
    channel_agent_map: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")

    # Fallback agent used when there is no channel-specific mapping.
    default_agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="SET NULL"),
        nullable=True,
    )

    default_agent: Mapped["Agent | None"] = relationship(foreign_keys=[default_agent_id])  # type: ignore[name-defined]
