from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import AgentRun
    from conflux.models.skill import Skill
    from conflux.models.user import User


class TraceEvent(UUIDMixin, Base):
    __tablename__ = "trace_events"

    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
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

    run: Mapped["AgentRun"] = relationship(back_populates="trace_events")


class ReflectionJob(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "reflection_jobs"

    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
    )
    was_successful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    learned_memories: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    drafted_skills: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped["AgentRun"] = relationship(back_populates="reflection_jobs")


class EvolutionCandidate(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "evolution_candidates"

    skill_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id"),
        nullable=True,
        index=True,
    )
    candidate_type: Mapped[str] = mapped_column(String, nullable=False)
    current_content: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_content: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    eval_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    eval_dataset: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    approval_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
    )
    approved_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision: Mapped[str | None] = mapped_column(String, nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    comparison_scores: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    test_results: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    detected_pattern: Mapped[str | None] = mapped_column(Text, nullable=True)
    pattern_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("improvement_patterns.id", ondelete="SET NULL"),
        nullable=True,
    )

    skill: Mapped["Skill | None"] = relationship(back_populates="evolution_candidates")
    approver: Mapped["User | None"] = relationship(
        back_populates="approved_evolution_candidates",
        foreign_keys=[approved_by],
    )


class ImprovementPattern(UUIDMixin, Base):
    __tablename__ = "improvement_patterns"

    detected_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    pattern_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    skill_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="SET NULL"),
        nullable=True,
    )
    frequency: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    severity: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_systemic: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    example_run_ids: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'new'"))

    skill: Mapped["Skill | None"] = relationship(foreign_keys=[skill_id])


class EvalCase(UUIDMixin, Base):
    __tablename__ = "eval_cases"

    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    skill_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    case_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    input_context: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    expected_behavior: Mapped[str] = mapped_column(Text, nullable=False)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'manual'"))
    source_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    tags: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))

    skill: Mapped["Skill | None"] = relationship(foreign_keys=[skill_id])


class SkillEvalRecord(UUIDMixin, Base):
    __tablename__ = "skill_eval_records"

    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    task_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    selection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_benefit: Mapped[str | None] = mapped_column(Text, nullable=True)
    dimensions_improved: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    negative_effects: Mapped[str | None] = mapped_column(Text, nullable=True)
    counterfactual_worse: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    evidence_strength: Mapped[float | None] = mapped_column(Float, nullable=True)
    did_improve: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    improvement_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'keep'"))
    eval_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped["AgentRun"] = relationship(back_populates="skill_eval_records", foreign_keys=[run_id])
    skill: Mapped["Skill"] = relationship(back_populates="eval_records", foreign_keys=[skill_id])
