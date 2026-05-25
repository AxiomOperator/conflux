"""MCP (Model Context Protocol) server configuration models."""
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import Agent
    from conflux.models.user import User


class McpServer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "mcp_servers"

    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    transport: Mapped[str] = mapped_column(String, nullable=False, default="stdio")

    # stdio transport fields
    command: Mapped[str | None] = mapped_column(Text, nullable=True)
    args: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="'[]'::jsonb")
    env: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")

    # SSE transport fields
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    headers: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")

    risk_level: Mapped[str] = mapped_column(String, nullable=False, default="moderate")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])
    agent_associations: Mapped[list["AgentMcpServer"]] = relationship(
        back_populates="mcp_server",
        cascade="all, delete-orphan",
    )


class AgentMcpServer(Base):
    __tablename__ = "agent_mcp_servers"
    __table_args__ = (UniqueConstraint("agent_id", "mcp_server_id", name="uq_agent_mcp_server"),)

    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, primary_key=True, index=True
    )
    mcp_server_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("mcp_servers.id"), nullable=False, primary_key=True, index=True
    )

    agent: Mapped["Agent"] = relationship(back_populates="mcp_servers")
    mcp_server: Mapped["McpServer"] = relationship(back_populates="agent_associations")
