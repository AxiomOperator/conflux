from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.agent import Agent
    from conflux.models.session import Session
    from conflux.models.skill import Skill
    from conflux.models.user import User


class Tenant(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    projects: Mapped[list["Project"]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    agents: Mapped[list["Agent"]] = relationship(back_populates="tenant")
    sessions: Mapped[list["Session"]] = relationship(back_populates="tenant")
    skills: Mapped[list["Skill"]] = relationship(back_populates="tenant")


class Project(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    owner_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    tenant: Mapped["Tenant"] = relationship(back_populates="projects")
    agents: Mapped[list["Agent"]] = relationship(back_populates="project")
    sessions: Mapped[list["Session"]] = relationship(back_populates="project")
    skills: Mapped[list["Skill"]] = relationship(back_populates="project")
    owner: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[owner_user_id],
        primaryjoin="Project.owner_user_id == User.id",
    )
