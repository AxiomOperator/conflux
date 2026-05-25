"""Scheduled task model."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import Agent
    from conflux.models.user import User


class ScheduledTask(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "scheduled_tasks"

    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    cron_expr: Mapped[str] = mapped_column(Text, nullable=False)
    input_template: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")
    channel: Mapped[str | None] = mapped_column(String, nullable=True)
    channel_target: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    next_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String, nullable=True)

    agent: Mapped["Agent"] = relationship(foreign_keys=[agent_id])
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])
