from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin


class Provider(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "providers"

    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    provider_type: Mapped[str] = mapped_column(String, nullable=False)
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    api_key: Mapped[str | None] = mapped_column(String, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    health_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="unknown",
        server_default=text("'unknown'"),
    )
    last_health_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    models: Mapped[list["ProviderModel"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
    )


class ProviderModel(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "provider_models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_name", name="uq_provider_models_provider_id_model_name"),
    )

    provider_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("providers.id"),
        nullable=False,
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_cost_per_1k: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default=text("0.0"),
    )
    output_cost_per_1k: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default=text("0.0"),
    )
    supports_streaming: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    supports_tool_calls: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    provider: Mapped["Provider"] = relationship(back_populates="models")
