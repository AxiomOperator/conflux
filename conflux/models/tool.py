"""Tool configuration model — persists built-in overrides and custom webhook tools."""
from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin


class ToolConfig(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tool_configs"

    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    description_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_level: Mapped[str] = mapped_column(String, nullable=False, default="safe")
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Custom webhook tool fields
    endpoint_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    http_method: Mapped[str | None] = mapped_column(String, nullable=True, default="POST")
    custom_headers: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    custom_parameters: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
