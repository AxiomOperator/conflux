from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import AgentRun
    from conflux.models.tenant import Project, Tenant
    from conflux.models.user import User


class Session(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sessions"

    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    tenant_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id"),
        nullable=True,
        index=True,
    )
    channel: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="api",
        server_default=text("'api'"),
    )
    channel_session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    user: Mapped["User | None"] = relationship(back_populates="sessions")
    tenant: Mapped["Tenant | None"] = relationship(back_populates="sessions")
    project: Mapped["Project | None"] = relationship(back_populates="sessions")
    runs: Mapped[list["AgentRun"]] = relationship(back_populates="session")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )


class Message(UUIDMixin, Base):
    __tablename__ = "messages"

    session_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("sessions.id"),
        nullable=False,
        index=True,
    )
    run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_call_id: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String, nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    session: Mapped["Session"] = relationship(back_populates="messages")
    run: Mapped["AgentRun | None"] = relationship(back_populates="messages")
