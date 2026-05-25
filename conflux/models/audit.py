from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from conflux.core.database import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    event_type: Mapped[str] = mapped_column(String(), nullable=False)
    agent_run_id: Mapped[str | None] = mapped_column(String(), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(), nullable=True)
    args_preview: Mapped[str | None] = mapped_column(Text(), nullable=True)
    result_preview: Mapped[str | None] = mapped_column(Text(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float(), nullable=True)

    __table_args__ = (
        Index("ix_audit_events_created_at", created_at),
        Index("ix_audit_events_event_type", "event_type"),
    )
