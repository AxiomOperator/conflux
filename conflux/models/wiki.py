from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, and_
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PGUUID
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

from conflux.core.database import Base
from conflux.models.base_mixin import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from conflux.models.user import User


class WikiGroup(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "wiki_groups"

    tenant_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    members: Mapped[list["WikiGroupMember"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
    )
    access_rules: Mapped[list["WikiAccessRule"]] = relationship(
        back_populates="group",
        primaryjoin=lambda: and_(
            foreign(WikiAccessRule.subject_id) == WikiGroup.id,
            WikiAccessRule.subject_type == "group",
        ),
        viewonly=True,
    )


class WikiGroupMember(Base):
    __tablename__ = "wiki_group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    group_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_groups.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    group: Mapped["WikiGroup"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])


class WikiSpace(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "wiki_spaces"

    tenant_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id"),
        nullable=True,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(200), index=True)
    name: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    default_access: Mapped[str] = mapped_column(String(20), default="private")
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    pages: Mapped[list["WikiPage"]] = relationship(
        back_populates="space",
        cascade="all, delete-orphan",
    )
    access_rules: Mapped[list["WikiAccessRule"]] = relationship(
        back_populates="space",
        cascade="all, delete-orphan",
    )


class WikiPage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "wiki_pages"

    space_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_spaces.id", ondelete="CASCADE"),
        index=True,
    )
    parent_page_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_pages.id"),
        nullable=True,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(500))
    content_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    fts_vector: Mapped[Any | None] = mapped_column(TSVECTOR, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    sources: Mapped[list] = mapped_column(JSONB, default=list, server_default="'[]'::jsonb")
    external_links: Mapped[list] = mapped_column(JSONB, default=list, server_default="'[]'::jsonb")
    internal_links: Mapped[list] = mapped_column(JSONB, default=list, server_default="'[]'::jsonb")
    tags: Mapped[list] = mapped_column(JSONB, default=list, server_default="'[]'::jsonb")

    space: Mapped["WikiSpace"] = relationship(back_populates="pages")
    parent: Mapped["WikiPage | None"] = relationship(
        back_populates="children",
        remote_side="WikiPage.id",
        foreign_keys=[parent_page_id],
    )
    children: Mapped[list["WikiPage"]] = relationship(
        back_populates="parent",
        foreign_keys=[parent_page_id],
    )
    versions: Mapped[list["WikiPageVersion"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
    )
    access_rules: Mapped[list["WikiAccessRule"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
    )


class WikiPageVersion(Base):
    __tablename__ = "wiki_page_versions"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer)
    content_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    page: Mapped["WikiPage"] = relationship(back_populates="versions")


class WikiAccessRule(Base):
    __tablename__ = "wiki_access_rules"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    space_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_spaces.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    page_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    subject_type: Mapped[str] = mapped_column(String(20))
    subject_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    permission: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    space: Mapped["WikiSpace | None"] = relationship(
        back_populates="access_rules",
        foreign_keys=[space_id],
    )
    page: Mapped["WikiPage | None"] = relationship(
        back_populates="access_rules",
        foreign_keys=[page_id],
    )
    group: Mapped["WikiGroup | None"] = relationship(
        back_populates="access_rules",
        primaryjoin=lambda: and_(
            foreign(WikiAccessRule.subject_id) == WikiGroup.id,
            WikiAccessRule.subject_type == "group",
        ),
        foreign_keys=[subject_id],
        viewonly=True,
    )
