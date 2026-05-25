"""Wiki CRUD routes."""
from __future__ import annotations

import io
import re
from datetime import datetime
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from slugify import slugify
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import get_db
from conflux.core.database import get_db_session
from conflux.models.user import User
from conflux.models.wiki import (
    WikiAccessRule,
    WikiGroup,
    WikiGroupMember,
    WikiPage,
    WikiPageVersion,
    WikiSpace,
)
from conflux.wiki.access import check_page_access, check_space_access
from conflux.wiki.embedder import delete_page_embeddings, embed_page

router = APIRouter(prefix='/v1')
_ALLOWED_SUBJECT_TYPES = {'everyone', 'user', 'group'}
_ALLOWED_PERMISSIONS = {'view', 'edit', 'admin'}
_ALLOWED_DEFAULT_ACCESS = {'private', 'public'}


class WikiGroupCreate(BaseModel):
    name: str
    description: str | None = None


class WikiGroupMemberCreate(BaseModel):
    user_id: UUID


class WikiSpaceCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    icon: str | None = None
    default_access: str = 'private'


class WikiSpaceUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    icon: str | None = None
    default_access: str | None = None


class WikiPageCreate(BaseModel):
    title: str
    slug: str
    content_markdown: str = ''
    parent_page_id: UUID | None = None
    sources: list[dict] = Field(default_factory=list)
    external_links: list[dict] = Field(default_factory=list)
    internal_links: list[dict] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class WikiPageUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    content_markdown: str | None = None
    parent_page_id: UUID | None = None
    sources: list[dict] = Field(default_factory=list)
    external_links: list[dict] = Field(default_factory=list)
    internal_links: list[dict] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class WikiAccessRuleCreate(BaseModel):
    subject_type: str
    subject_id: UUID | None = None
    permission: str
    page_id: UUID | None = None


class WikiGroupOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    created_at: datetime


class WikiSpaceOut(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    icon: str | None
    default_access: str
    created_by: UUID | None
    created_at: datetime


class WikiPageOut(BaseModel):
    id: UUID
    space_id: UUID
    parent_page_id: UUID | None
    title: str
    slug: str
    content_markdown: str | None
    position: int
    sources: list[dict] = Field(default_factory=list)
    external_links: list[dict] = Field(default_factory=list)
    internal_links: list[dict] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    created_by: UUID | None = None
    updated_by: UUID | None = None
    updated_by_display_name: str | None = None
    created_by_display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class WikiPageTreeItem(BaseModel):
    id: UUID
    title: str
    slug: str
    parent_page_id: UUID | None
    position: int
    children: list['WikiPageTreeItem'] = Field(default_factory=list)


class WikiAccessRuleOut(BaseModel):
    id: UUID
    space_id: UUID | None
    page_id: UUID | None
    subject_type: str
    subject_id: UUID | None
    permission: str


class WikiVersionOut(BaseModel):
    id: UUID
    page_id: UUID
    version_number: int
    created_by: UUID | None
    created_at: datetime


WikiPageTreeItem.model_rebuild()


def content_text_from_markdown(md: str) -> str:
    text_value = re.sub(r'```.*?```', ' ', md, flags=re.S)
    text_value = re.sub(r'`([^`]*)`', r'\1', text_value)
    text_value = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', text_value)
    text_value = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text_value)
    text_value = re.sub(r'^#{1,6}\s*', '', text_value, flags=re.M)
    text_value = re.sub(r'(^|\n)\s{0,3}[-*+]\s+', r'\1', text_value)
    text_value = re.sub(r'(^|\n)\s{0,3}\d+\.\s+', r'\1', text_value)
    text_value = re.sub(r'[>*_~#]', ' ', text_value)
    text_value = re.sub(r'[ \t]+', ' ', text_value)
    text_value = re.sub(r'\n{3,}', '\n\n', text_value)
    return text_value.strip()


def _as_uuid(value: str | UUID | None) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _tenant_filter(column, tenant_id: UUID | None):
    return column.is_(None) if tenant_id is None else column == tenant_id


def _normalize_slug(value: str) -> str:
    normalized = slugify(value or '')
    if not normalized:
        raise HTTPException(400, 'Slug is required')
    return normalized


def _group_out(group: WikiGroup) -> WikiGroupOut:
    return WikiGroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        created_at=group.created_at,
    )


def _space_out(space: WikiSpace) -> WikiSpaceOut:
    return WikiSpaceOut(
        id=space.id,
        name=space.name,
        slug=space.slug,
        description=space.description,
        icon=space.icon,
        default_access=space.default_access,
        created_by=space.created_by,
        created_at=space.created_at,
    )


def _page_out(
    page: WikiPage,
    updated_by_display_name: str | None = None,
    created_by_display_name: str | None = None,
) -> WikiPageOut:
    return WikiPageOut(
        id=page.id,
        space_id=page.space_id,
        parent_page_id=page.parent_page_id,
        title=page.title,
        slug=page.slug,
        content_markdown=page.content_markdown,
        position=page.position,
        sources=page.sources or [],
        external_links=page.external_links or [],
        internal_links=page.internal_links or [],
        tags=page.tags or [],
        created_by=page.created_by,
        updated_by=page.updated_by,
        updated_by_display_name=updated_by_display_name,
        created_by_display_name=created_by_display_name,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )


def _rule_out(rule: WikiAccessRule) -> WikiAccessRuleOut:
    return WikiAccessRuleOut(
        id=rule.id,
        space_id=rule.space_id,
        page_id=rule.page_id,
        subject_type=rule.subject_type,
        subject_id=rule.subject_id,
        permission=rule.permission,
    )


def _version_out(version: WikiPageVersion) -> WikiVersionOut:
    return WikiVersionOut(
        id=version.id,
        page_id=version.page_id,
        version_number=version.version_number,
        created_by=version.created_by,
        created_at=version.created_at,
    )


async def _get_space(db: AsyncSession, space_id: UUID, tenant_id: UUID | None) -> WikiSpace:
    space = (
        await db.execute(
            select(WikiSpace).where(WikiSpace.id == space_id, _tenant_filter(WikiSpace.tenant_id, tenant_id))
        )
    ).scalar_one_or_none()
    if not space:
        raise HTTPException(404, 'Wiki space not found')
    return space


async def _get_group(db: AsyncSession, group_id: UUID, tenant_id: UUID | None) -> WikiGroup:
    group = (
        await db.execute(
            select(WikiGroup).where(WikiGroup.id == group_id, _tenant_filter(WikiGroup.tenant_id, tenant_id))
        )
    ).scalar_one_or_none()
    if not group:
        raise HTTPException(404, 'Wiki group not found')
    return group


async def _get_page(db: AsyncSession, page_id: UUID) -> WikiPage:
    page = (await db.execute(select(WikiPage).where(WikiPage.id == page_id))).scalar_one_or_none()
    if not page:
        raise HTTPException(404, 'Wiki page not found')
    return page


async def _assert_page_scope(db: AsyncSession, page: WikiPage, tenant_id: UUID | None) -> WikiSpace:
    space = await db.get(WikiSpace, page.space_id)
    if not space or space.tenant_id != tenant_id:
        raise HTTPException(404, 'Wiki page not found')
    return space


async def _ensure_user_exists(db: AsyncSession, user_id: UUID) -> None:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, 'User not found')


async def _get_user_display(db: AsyncSession, user_id: UUID | None) -> str | None:
    if not user_id:
        return None
    result = await db.execute(select(User.display_name).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _ensure_space_slug_unique(
    db: AsyncSession,
    tenant_id: UUID | None,
    slug: str,
    exclude_id: UUID | None = None,
) -> None:
    query = select(WikiSpace).where(
        WikiSpace.slug == slug,
        _tenant_filter(WikiSpace.tenant_id, tenant_id),
    )
    if exclude_id:
        query = query.where(WikiSpace.id != exclude_id)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Wiki space slug '{slug}' already exists")


async def _ensure_page_slug_unique(
    db: AsyncSession,
    space_id: UUID,
    slug: str,
    exclude_id: UUID | None = None,
) -> None:
    query = select(WikiPage).where(WikiPage.space_id == space_id, WikiPage.slug == slug)
    if exclude_id:
        query = query.where(WikiPage.id != exclude_id)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Wiki page slug '{slug}' already exists")


async def _validate_parent_page(
    db: AsyncSession,
    space_id: UUID,
    parent_page_id: UUID | None,
    page_id: UUID | None = None,
) -> None:
    if parent_page_id is None:
        return
    if page_id and parent_page_id == page_id:
        raise HTTPException(400, 'A page cannot be its own parent')
    parent = await db.get(WikiPage, parent_page_id)
    if not parent or parent.space_id != space_id:
        raise HTTPException(400, 'Parent page must belong to the same space')


async def _next_page_position(
    db: AsyncSession,
    space_id: UUID,
    parent_page_id: UUID | None,
) -> int:
    query = select(func.max(WikiPage.position)).where(WikiPage.space_id == space_id)
    if parent_page_id is None:
        query = query.where(WikiPage.parent_page_id.is_(None))
    else:
        query = query.where(WikiPage.parent_page_id == parent_page_id)
    current_max = (await db.execute(query)).scalar_one()
    return (current_max or 0) + 1


def _build_page_tree(pages: list[WikiPage]) -> list[WikiPageTreeItem]:
    items = {
        page.id: WikiPageTreeItem(
            id=page.id,
            title=page.title,
            slug=page.slug,
            parent_page_id=page.parent_page_id,
            position=page.position,
        )
        for page in pages
    }
    roots: list[WikiPageTreeItem] = []
    for page in sorted(pages, key=lambda item: (item.position, item.title.lower())):
        tree_item = items[page.id]
        parent = items.get(page.parent_page_id)
        if parent:
            parent.children.append(tree_item)
        else:
            roots.append(tree_item)
    return roots


async def _embed_page_task(page_id: UUID) -> None:
    async with get_db_session() as embed_db:
        await embed_page(embed_db, page_id)


async def _refresh_page_fts(db: AsyncSession, page_id: UUID, content_text: str) -> None:
    await db.execute(
        text("UPDATE wiki_pages SET fts_vector = to_tsvector('english', :txt) WHERE id = :id"),
        {'txt': content_text, 'id': page_id},
    )


@router.get('/admin/wiki/groups', response_model=list[WikiGroupOut])
async def list_wiki_groups(
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _as_uuid(user.tenant_id)
    groups = (
        await db.execute(
            select(WikiGroup)
            .where(_tenant_filter(WikiGroup.tenant_id, tenant_id))
            .order_by(WikiGroup.name.asc())
        )
    ).scalars().all()
    return [_group_out(group) for group in groups]


@router.post('/admin/wiki/groups', response_model=WikiGroupOut, status_code=201)
async def create_wiki_group(
    body: WikiGroupCreate,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _as_uuid(user.tenant_id)
    group = WikiGroup(
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
    )
    db.add(group)
    await db.flush()
    await db.refresh(group)
    return _group_out(group)


@router.delete('/admin/wiki/groups/{group_id}', status_code=204)
async def delete_wiki_group(
    group_id: UUID,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group(db, group_id, _as_uuid(user.tenant_id))
    await db.delete(group)


@router.post('/admin/wiki/groups/{group_id}/members', status_code=201)
async def add_wiki_group_member(
    group_id: UUID,
    body: WikiGroupMemberCreate,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    await _get_group(db, group_id, _as_uuid(user.tenant_id))
    await _ensure_user_exists(db, body.user_id)
    existing = (
        await db.execute(
            select(WikiGroupMember).where(
                WikiGroupMember.group_id == group_id,
                WikiGroupMember.user_id == body.user_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, 'User is already a member of this wiki group')
    membership = WikiGroupMember(group_id=group_id, user_id=body.user_id)
    db.add(membership)
    await db.flush()
    return {'group_id': group_id, 'user_id': body.user_id}


@router.delete('/admin/wiki/groups/{group_id}/members/{user_id}', status_code=204)
async def remove_wiki_group_member(
    group_id: UUID,
    user_id: UUID,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    await _get_group(db, group_id, _as_uuid(user.tenant_id))
    membership = (
        await db.execute(
            select(WikiGroupMember).where(
                WikiGroupMember.group_id == group_id,
                WikiGroupMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not membership:
        return Response(status_code=204)
    await db.delete(membership)


@router.get('/wiki/spaces', response_model=list[WikiSpaceOut])
async def list_wiki_spaces(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    user_id = _as_uuid(user.user_id)
    tenant_id = _as_uuid(user.tenant_id)
    spaces = (
        await db.execute(
            select(WikiSpace)
            .where(_tenant_filter(WikiSpace.tenant_id, tenant_id))
            .order_by(WikiSpace.name.asc())
        )
    ).scalars().all()
    visible_spaces: list[WikiSpaceOut] = []
    for space in spaces:
        if await check_space_access(
            db,
            space,
            user_id,
            user.is_admin,
            permission='view',
            view_as_user=user.view_as_user,
        ):
            visible_spaces.append(_space_out(space))
    return visible_spaces


@router.post('/admin/wiki/spaces', response_model=WikiSpaceOut, status_code=201)
async def create_wiki_space(
    body: WikiSpaceCreate,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    if body.default_access not in _ALLOWED_DEFAULT_ACCESS:
        raise HTTPException(400, 'Invalid default_access')
    tenant_id = _as_uuid(user.tenant_id)
    normalized_slug = _normalize_slug(body.slug)
    await _ensure_space_slug_unique(db, tenant_id, normalized_slug)
    space = WikiSpace(
        tenant_id=tenant_id,
        name=body.name,
        slug=normalized_slug,
        description=body.description,
        icon=body.icon,
        default_access=body.default_access,
        created_by=_as_uuid(user.user_id),
    )
    db.add(space)
    await db.flush()
    await db.refresh(space)
    return _space_out(space)


@router.put('/admin/wiki/spaces/{space_id}', response_model=WikiSpaceOut)
async def update_wiki_space(
    space_id: UUID,
    body: WikiSpaceUpdate,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    space = await _get_space(db, space_id, _as_uuid(user.tenant_id))
    updates = body.model_dump(exclude_unset=True)
    if 'slug' in updates:
        updates['slug'] = _normalize_slug(updates['slug'])
        await _ensure_space_slug_unique(db, _as_uuid(user.tenant_id), updates['slug'], exclude_id=space_id)
    if 'default_access' in updates and updates['default_access'] not in _ALLOWED_DEFAULT_ACCESS:
        raise HTTPException(400, 'Invalid default_access')
    for field, value in updates.items():
        setattr(space, field, value)
    await db.flush()
    await db.refresh(space)
    return _space_out(space)


@router.delete('/admin/wiki/spaces/{space_id}', status_code=204)
async def delete_wiki_space(
    space_id: UUID,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    space = await _get_space(db, space_id, _as_uuid(user.tenant_id))
    await db.delete(space)


@router.get('/wiki/spaces/{space_id}/pages', response_model=list[WikiPageTreeItem])
async def list_wiki_pages(
    space_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    user_id = _as_uuid(user.user_id)
    space = await _get_space(db, space_id, _as_uuid(user.tenant_id))
    if not await check_space_access(
        db,
        space,
        user_id,
        user.is_admin,
        permission='view',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    pages = (
        await db.execute(
            select(WikiPage)
            .where(WikiPage.space_id == space_id)
            .order_by(WikiPage.position.asc(), WikiPage.title.asc())
        )
    ).scalars().all()
    visible_pages: list[WikiPage] = []
    for page in pages:
        if await check_page_access(
            db,
            page,
            user_id,
            user.is_admin,
            permission='view',
            view_as_user=user.view_as_user,
        ):
            visible_pages.append(page)
    return _build_page_tree(visible_pages)


@router.get('/wiki/pages/{page_id}', response_model=WikiPageOut)
async def get_wiki_page(
    page_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    page = await _get_page(db, page_id)
    await _assert_page_scope(db, page, _as_uuid(user.tenant_id))
    if not await check_page_access(
        db,
        page,
        _as_uuid(user.user_id),
        user.is_admin,
        permission='view',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    return _page_out(
        page,
        updated_by_display_name=await _get_user_display(db, page.updated_by),
        created_by_display_name=await _get_user_display(db, page.created_by),
    )


@router.get('/wiki/pages/{page_id}/share')
async def get_wiki_page_share(
    page_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    page = await _get_page(db, page_id)
    space = await _assert_page_scope(db, page, _as_uuid(user.tenant_id))
    if not await check_page_access(
        db,
        page,
        _as_uuid(user.user_id),
        user.is_admin,
        permission='view',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    return {
        'page_id': str(page.id),
        'title': page.title,
        'slug': page.slug,
        'space_slug': space.slug if space else None,
    }


@router.post('/wiki/spaces/{space_id}/pages', response_model=WikiPageOut, status_code=201)
async def create_wiki_page(
    space_id: UUID,
    body: WikiPageCreate,
    background_tasks: BackgroundTasks,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    user_id = _as_uuid(user.user_id)
    space = await _get_space(db, space_id, _as_uuid(user.tenant_id))
    if not await check_space_access(
        db,
        space,
        user_id,
        user.is_admin,
        permission='edit',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    normalized_slug = _normalize_slug(body.slug)
    await _ensure_page_slug_unique(db, space_id, normalized_slug)
    await _validate_parent_page(db, space_id, body.parent_page_id)
    page = WikiPage(
        space_id=space_id,
        parent_page_id=body.parent_page_id,
        title=body.title,
        slug=normalized_slug,
        content_markdown=body.content_markdown,
        content_text=content_text_from_markdown(body.content_markdown),
        position=await _next_page_position(db, space_id, body.parent_page_id),
        created_by=user_id,
        updated_by=user_id,
        sources=body.sources,
        external_links=body.external_links,
        internal_links=body.internal_links,
        tags=body.tags,
    )
    db.add(page)
    await db.flush()
    await _refresh_page_fts(db, page.id, page.content_text or '')
    background_tasks.add_task(_embed_page_task, page.id)
    await db.refresh(page)
    return _page_out(
        page,
        updated_by_display_name=await _get_user_display(db, page.updated_by),
        created_by_display_name=await _get_user_display(db, page.created_by),
    )


@router.put('/wiki/pages/{page_id}', response_model=WikiPageOut)
async def update_wiki_page(
    page_id: UUID,
    body: WikiPageUpdate,
    background_tasks: BackgroundTasks,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    page = await _get_page(db, page_id)
    await _assert_page_scope(db, page, _as_uuid(user.tenant_id))
    if not await check_page_access(
        db,
        page,
        _as_uuid(user.user_id),
        user.is_admin,
        permission='edit',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')

    next_version_number = (
        (await db.execute(select(func.max(WikiPageVersion.version_number)).where(WikiPageVersion.page_id == page_id))).scalar_one()
        or 0
    ) + 1
    db.add(
        WikiPageVersion(
            page_id=page.id,
            version_number=next_version_number,
            content_markdown=page.content_markdown,
            created_by=_as_uuid(user.user_id),
        )
    )

    updates = body.model_dump(exclude_unset=True)
    if 'slug' in updates:
        updates['slug'] = _normalize_slug(updates['slug'])
        await _ensure_page_slug_unique(db, page.space_id, updates['slug'], exclude_id=page.id)
    if 'parent_page_id' in updates:
        await _validate_parent_page(db, page.space_id, updates['parent_page_id'], page_id=page.id)
    for field, value in updates.items():
        setattr(page, field, value)
    if 'content_markdown' in updates:
        page.content_text = content_text_from_markdown(page.content_markdown or '')
    page.updated_by = _as_uuid(user.user_id)
    await db.flush()
    await _refresh_page_fts(db, page.id, page.content_text or '')
    background_tasks.add_task(_embed_page_task, page.id)
    await db.refresh(page)
    return _page_out(
        page,
        updated_by_display_name=await _get_user_display(db, page.updated_by),
        created_by_display_name=await _get_user_display(db, page.created_by),
    )


@router.delete('/wiki/pages/{page_id}', status_code=204)
async def delete_wiki_page(
    page_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    page = await _get_page(db, page_id)
    await _assert_page_scope(db, page, _as_uuid(user.tenant_id))
    if not await check_page_access(
        db,
        page,
        _as_uuid(user.user_id),
        user.is_admin,
        permission='admin',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    pages_in_space = (
        await db.execute(select(WikiPage).where(WikiPage.space_id == page.space_id))
    ).scalars().all()
    by_parent: dict[UUID | None, list[WikiPage]] = {}
    for candidate in pages_in_space:
        by_parent.setdefault(candidate.parent_page_id, []).append(candidate)

    stack = [page]
    ordered: list[WikiPage] = []
    while stack:
        current = stack.pop()
        ordered.append(current)
        stack.extend(by_parent.get(current.id, []))
    for current in ordered:
        background_tasks.add_task(delete_page_embeddings, current.id)
    for current in reversed(ordered):
        await db.delete(current)


@router.get('/wiki/pages/{page_id}/versions', response_model=list[WikiVersionOut])
async def list_wiki_page_versions(
    page_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    page = await _get_page(db, page_id)
    await _assert_page_scope(db, page, _as_uuid(user.tenant_id))
    if not await check_page_access(
        db,
        page,
        _as_uuid(user.user_id),
        user.is_admin,
        permission='view',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    versions = (
        await db.execute(
            select(WikiPageVersion)
            .where(WikiPageVersion.page_id == page_id)
            .order_by(WikiPageVersion.version_number.desc())
        )
    ).scalars().all()
    return [_version_out(version) for version in versions]


@router.get('/admin/wiki/spaces/{space_id}/rules', response_model=list[WikiAccessRuleOut])
async def list_wiki_access_rules(
    space_id: UUID,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    await _get_space(db, space_id, _as_uuid(user.tenant_id))
    rules = (
        await db.execute(
            select(WikiAccessRule)
            .where(WikiAccessRule.space_id == space_id)
            .order_by(WikiAccessRule.created_at.asc())
        )
    ).scalars().all()
    return [_rule_out(rule) for rule in rules]


@router.post('/admin/wiki/spaces/{space_id}/rules', response_model=WikiAccessRuleOut, status_code=201)
async def create_wiki_access_rule(
    space_id: UUID,
    body: WikiAccessRuleCreate,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    await _get_space(db, space_id, _as_uuid(user.tenant_id))
    if body.subject_type not in _ALLOWED_SUBJECT_TYPES:
        raise HTTPException(400, 'Invalid subject_type')
    if body.permission not in _ALLOWED_PERMISSIONS:
        raise HTTPException(400, 'Invalid permission')
    if body.subject_type == 'everyone' and body.subject_id is not None:
        raise HTTPException(400, 'subject_id must be null for everyone rules')
    if body.subject_type != 'everyone' and body.subject_id is None:
        raise HTTPException(400, 'subject_id is required for user and group rules')
    if body.subject_type == 'user' and body.subject_id is not None:
        await _ensure_user_exists(db, body.subject_id)
    if body.subject_type == 'group' and body.subject_id is not None:
        await _get_group(db, body.subject_id, _as_uuid(user.tenant_id))
    if body.page_id is not None:
        page = await _get_page(db, body.page_id)
        if page.space_id != space_id:
            raise HTTPException(400, 'Page rule must target a page in the same space')
    rule = WikiAccessRule(
        space_id=space_id,
        page_id=body.page_id,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        permission=body.permission,
    )
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    return _rule_out(rule)


@router.delete('/admin/wiki/rules/{rule_id}', status_code=204)
async def delete_wiki_access_rule(
    rule_id: UUID,
    user: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    rule = (await db.execute(select(WikiAccessRule).where(WikiAccessRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        return Response(status_code=204)
    if rule.space_id is None:
        raise HTTPException(404, 'Wiki rule not found')
    await _get_space(db, rule.space_id, _as_uuid(user.tenant_id))
    await db.delete(rule)


@router.post('/wiki/spaces/{space_id}/upload', response_model=WikiPageOut, status_code=201)
async def upload_wiki_file(
    space_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    user_id = _as_uuid(user.user_id)
    space = await _get_space(db, space_id, _as_uuid(user.tenant_id))
    if not await check_space_access(
        db,
        space,
        user_id,
        user.is_admin,
        permission='edit',
        view_as_user=user.view_as_user,
    ):
        raise HTTPException(403, 'Forbidden')
    filename = file.filename or ''
    suffix = Path(filename).suffix.lower()
    if suffix not in {'.md', '.pdf'}:
        raise HTTPException(400, 'Only .pdf and .md uploads are supported')

    file_bytes = await file.read()
    title = Path(filename).stem or 'uploaded-file'
    slug = _normalize_slug(title)
    content_markdown: str
    if suffix == '.md':
        content_markdown = file_bytes.decode('utf-8', errors='ignore')
        content_text = content_text_from_markdown(content_markdown)
    else:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(file_bytes))
        extracted = '\n\n'.join((page.extract_text() or '').strip() for page in reader.pages)
        content_text = extracted.strip()
        content_markdown = content_text

    await _ensure_page_slug_unique(db, space_id, slug)
    page = WikiPage(
        space_id=space_id,
        title=title,
        slug=slug,
        content_markdown=content_markdown,
        content_text=content_text,
        position=await _next_page_position(db, space_id, None),
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(page)
    await db.flush()
    await _refresh_page_fts(db, page.id, page.content_text or '')
    background_tasks.add_task(_embed_page_task, page.id)
    await db.refresh(page)
    return _page_out(
        page,
        updated_by_display_name=await _get_user_display(db, page.updated_by),
        created_by_display_name=await _get_user_display(db, page.created_by),
    )
