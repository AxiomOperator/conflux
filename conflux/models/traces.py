from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Float, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from conflux.core.database import Base


class RequestTrace(Base):
    __tablename__ = "request_traces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    method: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    query_string: Mapped[str | None] = mapped_column(Text)
    status_code: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[float] = mapped_column(Float)
    user_email: Mapped[str | None] = mapped_column(Text)
    remote_ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_body: Mapped[str | None] = mapped_column(Text)
    response_body: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_request_traces_created_at_desc", created_at.desc()),
        Index("ix_request_traces_user_created_desc", "user_email", created_at.desc()),
    )
