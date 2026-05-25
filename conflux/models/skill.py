from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import AgentRun
    from conflux.models.learning import EvalCase, EvolutionCandidate, ImprovementPattern, SkillEvalRecord
    from conflux.models.tenant import Project, Tenant
    from conflux.models.user import User


class Skill(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "skills"

    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    approval_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="draft",
        server_default=text("'draft'"),
    )
    owner_user_id: Mapped[UUID | None] = mapped_column(
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
    is_global: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    active_version_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skill_versions.id"),
        nullable=True,
        index=True,
    )

    owner_user: Mapped["User | None"] = relationship(
        back_populates="owned_skills",
        foreign_keys=[owner_user_id],
    )
    tenant: Mapped["Tenant | None"] = relationship(back_populates="skills")
    project: Mapped["Project | None"] = relationship(back_populates="skills")
    active_version: Mapped["SkillVersion | None"] = relationship(
        foreign_keys=[active_version_id],
        post_update=True,
    )
    versions: Mapped[list["SkillVersion"]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
        foreign_keys="SkillVersion.skill_id",
        order_by="SkillVersion.version",
    )
    files: Mapped[list["SkillFile"]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
    )
    usage_events: Mapped[list["SkillUsageEvent"]] = relationship(back_populates="skill")
    failure_events: Mapped[list["SkillFailureEvent"]] = relationship(back_populates="skill")
    evolution_candidates: Mapped[list["EvolutionCandidate"]] = relationship(back_populates="skill")
    eval_records: Mapped[list["SkillEvalRecord"]] = relationship(
        back_populates="skill",
        foreign_keys="SkillEvalRecord.skill_id",
    )
    eval_cases: Mapped[list["EvalCase"]] = relationship(foreign_keys="EvalCase.skill_id")
    improvement_patterns: Mapped[list["ImprovementPattern"]] = relationship(
        foreign_keys="ImprovementPattern.skill_id",
    )


class SkillVersion(UUIDMixin, Base):
    __tablename__ = "skill_versions"

    skill_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    promoted_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    eval_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    skill: Mapped["Skill"] = relationship(
        back_populates="versions",
        foreign_keys=[skill_id],
    )
    promoter: Mapped["User | None"] = relationship(
        back_populates="promoted_skill_versions",
        foreign_keys=[promoted_by],
    )
    files: Mapped[list["SkillFile"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )


class SkillFile(UUIDMixin, Base):
    __tablename__ = "skill_files"

    skill_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skill_versions.id"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    skill: Mapped["Skill"] = relationship(back_populates="files")
    version: Mapped["SkillVersion"] = relationship(back_populates="files")


class SkillUsageEvent(UUIDMixin, Base):
    __tablename__ = "skill_usage_events"

    skill_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id"),
        nullable=False,
        index=True,
    )
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    was_helpful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    skill: Mapped["Skill"] = relationship(back_populates="usage_events")
    run: Mapped["AgentRun"] = relationship(back_populates="skill_usage_events")


class SkillFailureEvent(UUIDMixin, Base):
    __tablename__ = "skill_failure_events"

    skill_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("skills.id"),
        nullable=False,
        index=True,
    )
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_runs.id"),
        nullable=False,
        index=True,
    )
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    skill: Mapped["Skill"] = relationship(back_populates="failure_events")
    run: Mapped["AgentRun"] = relationship(back_populates="skill_failure_events")
