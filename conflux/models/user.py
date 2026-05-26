from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import Agent, AgentRun
    from conflux.models.learning import EvolutionCandidate
    from conflux.models.memory import Memory
    from conflux.models.session import Session
    from conflux.models.skill import Skill, SkillVersion
    from conflux.models.tenant import Project, Tenant


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    azure_oid: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    onboarding_completed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
    )
    personal_project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id"),
        nullable=True,
    )
    personal_tenant_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id"),
        nullable=True,
    )

    api_keys: Mapped[list["APIKey"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")
    memories: Mapped[list["Memory"]] = relationship(back_populates="user")
    owned_skills: Mapped[list["Skill"]] = relationship(
        back_populates="owner_user",
        foreign_keys="Skill.owner_user_id",
    )
    created_agents: Mapped[list["Agent"]] = relationship(
        back_populates="creator",
        foreign_keys="Agent.created_by",
    )
    agent_runs: Mapped[list["AgentRun"]] = relationship(back_populates="user")
    persona_files: Mapped["UserPersonaFiles | None"] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    view_as_setting: Mapped["UserViewAsSetting | None"] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    promoted_skill_versions: Mapped[list["SkillVersion"]] = relationship(
        back_populates="promoter",
        foreign_keys="SkillVersion.promoted_by",
    )
    approved_evolution_candidates: Mapped[list["EvolutionCandidate"]] = relationship(
        back_populates="approver",
        foreign_keys="EvolutionCandidate.approved_by",
    )


class APIKey(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "api_keys"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    key_hash: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    user: Mapped["User"] = relationship(back_populates="api_keys")


class UserViewAsSetting(Base):
    __tablename__ = "user_view_as_settings"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    view_as_user: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="view_as_setting")


class UserPersonaFiles(UUIDMixin, TimestampMixin, Base):
    """Per-user persona and operating instruction files loaded into agent context."""

    __tablename__ = "user_persona_files"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Operating instructions for the agent
    agents_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Persona, tone, and boundaries
    soul_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Who the user is and how to address them
    user_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Agent's name, vibe, and emoji
    identity_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Local tool conventions
    tools_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional heartbeat checklist
    heartbeat_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional startup checklist
    boot_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    personality_preset: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped["User"] = relationship(back_populates="persona_files")


class TelegramLink(UUIDMixin, TimestampMixin, Base):
    """Maps a Telegram user ID to a Conflux user (established via API key)."""

    __tablename__ = "telegram_links"

    telegram_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True, index=True)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    linked_via_key_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )

    user: Mapped["User"] = relationship()


class DiscordLink(UUIDMixin, TimestampMixin, Base):
    """Maps a Discord user ID to a Conflux user (established via /link <api_key>)."""

    __tablename__ = "discord_links"

    discord_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True, index=True)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    linked_via_key_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )

    user: Mapped["User"] = relationship()
