from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import FetchedValue, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.user import User


class Memory(UUIDMixin, TimestampMixin, Base):
    __tablename__ = 'memories'
    __table_args__ = (
        UniqueConstraint('scope', 'scope_id', 'key', name='uq_memories_scope_scope_id_key'),
    )

    scope: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str | None] = mapped_column(String, nullable=True)
    key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    qdrant_id: Mapped[str | None] = mapped_column(String, nullable=True)
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        nullable=True,
        server_default=FetchedValue(),
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey('users.id'),
        nullable=True,
        index=True,
    )

    user: Mapped['User | None'] = relationship(back_populates='memories')
