from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, FetchedValue, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.learning import ReflectionJob, SkillEvalRecord, TraceEvent
    from conflux.models.mcp import AgentMcpServer
    from conflux.models.session import Message, Session
    from conflux.models.skill import SkillFailureEvent, SkillUsageEvent
    from conflux.models.tenant import Project, Tenant
    from conflux.models.user import User


class Agent(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "agents"

    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    agent_type: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_policy: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    tool_allowlist: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    retrieval_tags: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    output_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    max_iterations: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=20,
        server_default=text("20"),
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    wiki_rag_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
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
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    tenant: Mapped["Tenant | None"] = relationship(back_populates="agents")
    project: Mapped["Project | None"] = relationship(back_populates="agents")
    creator: Mapped["User | None"] = relationship(
        back_populates="created_agents",
        foreign_keys=[created_by],
    )
    runs: Mapped[list["AgentRun"]] = relationship(back_populates="agent")
    mcp_servers: Mapped[list["AgentMcpServer"]] = relationship(
        back_populates="agent",
        cascade="all, delete-orphan",
    )


class AgentRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "agent_runs"

    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agents.id"),
        nullable=False,
        index=True,
    )
    parent_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=True,
        index=True,
    )
    session_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("sessions.id"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="queued",
        server_default=text("'queued'"),
    )
    input: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    output: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    provider_used: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    compressed_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_compressed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    is_undone: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        nullable=True,
        server_default=FetchedValue(),
    )

    agent: Mapped["Agent"] = relationship(back_populates="runs")
    parent_run: Mapped["AgentRun | None"] = relationship(
        back_populates="child_runs",
        remote_side="AgentRun.id",
        foreign_keys=[parent_run_id],
    )
    child_runs: Mapped[list["AgentRun"]] = relationship(back_populates="parent_run")
    session: Mapped["Session | None"] = relationship(back_populates="runs")
    user: Mapped["User | None"] = relationship(back_populates="agent_runs")
    events: Mapped[list["RunEvent"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    delegations_as_parent: Mapped[list["SubagentDelegation"]] = relationship(
        back_populates="parent_run",
        foreign_keys="SubagentDelegation.parent_run_id",
    )
    delegations_as_child: Mapped[list["SubagentDelegation"]] = relationship(
        back_populates="child_run",
        foreign_keys="SubagentDelegation.child_run_id",
    )
    messages: Mapped[list["Message"]] = relationship(back_populates="run")
    trace_events: Mapped[list["TraceEvent"]] = relationship(back_populates="run")
    reflection_jobs: Mapped[list["ReflectionJob"]] = relationship(back_populates="run")
    skill_eval_records: Mapped[list["SkillEvalRecord"]] = relationship(
        back_populates="run",
        foreign_keys="SkillEvalRecord.run_id",
    )
    skill_usage_events: Mapped[list["SkillUsageEvent"]] = relationship(back_populates="run")
    skill_failure_events: Mapped[list["SkillFailureEvent"]] = relationship(back_populates="run")


class RunEvent(UUIDMixin, Base):
    __tablename__ = "run_events"

    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    run: Mapped["AgentRun"] = relationship(back_populates="events")


class SubagentDelegation(UUIDMixin, Base):
    __tablename__ = "subagent_delegations"

    parent_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    child_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    context: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    constraints: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    parent_run: Mapped["AgentRun"] = relationship(
        back_populates="delegations_as_parent",
        foreign_keys=[parent_run_id],
    )
    child_run: Mapped["AgentRun"] = relationship(
        back_populates="delegations_as_child",
        foreign_keys=[child_run_id],
    )
