"""Skills routes."""
import re
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.integrations.skillsmp import fetch_skill_content, search_marketplace
from conflux.models.skill import Skill, SkillVersion
from conflux.skills.manager import SkillManager

router = APIRouter()
_manager = SkillManager()


class SkillCreateInput(BaseModel):
    name: str
    description: str
    category: str | None = None
    content: str
    is_global: bool = False
    auto_approve: bool = False


@router.get('')
async def list_skills(user: CurrentUser, limit: int = 50):
    return await _manager.list_skills(limit=limit, tenant_id=user.tenant_id)


@router.post('')
async def create_skill(body: SkillCreateInput, db: DB, user: AdminUser):
    """Admin endpoint to manually create a skill."""
    import re
    slug = re.sub(r'[^a-z0-9]+', '-', body.name.lower()).strip('-')
    existing = await db.execute(select(Skill).where(Skill.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{str(user.user_id)[:4]}"

    status = "approved" if body.auto_approve else "draft"
    skill = Skill(
        name=body.name,
        slug=slug,
        description=body.description,
        category=body.category,
        approval_status=status,
        is_global=body.is_global,
        tenant_id=user.tenant_id,
    )
    db.add(skill)
    await db.flush()

    version = SkillVersion(
        skill_id=skill.id,
        version=1,
        content=body.content,
        promoted_by=user.user_id if body.auto_approve else None,
    )
    db.add(version)
    await db.flush()

    if body.auto_approve:
        skill.active_version_id = version.id
    await db.commit()
    await db.refresh(skill)

    return {
        'id': str(skill.id),
        'name': skill.name,
        'slug': skill.slug,
        'approval_status': skill.approval_status,
        'created_at': skill.created_at.isoformat() if skill.created_at else None,
    }


@router.get('/pending')
async def list_pending_skills(db: DB, user: AdminUser):
    result = await db.execute(
        select(Skill).where(Skill.approval_status.in_(['draft', 'pending_review']))
    )
    skills = result.scalars().all()
    return [
        {
            'id': str(skill.id),
            'name': skill.name,
            'slug': skill.slug,
            'description': skill.description,
            'category': skill.category,
            'approval_status': skill.approval_status,
            'created_at': skill.created_at.isoformat() if skill.created_at else None,
            'tenant_id': str(skill.tenant_id) if skill.tenant_id else None,
        }
        for skill in skills
    ]


@router.get('/{slug}')
async def get_skill(slug: str, user: CurrentUser):
    skill = await _manager.get_skill_content(slug)
    if not skill:
        raise HTTPException(404, 'Skill not found')
    return skill


@router.post('/{skill_id}/approve')
async def approve_skill(skill_id: UUID, user: AdminUser):
    ok = await _manager.approve_skill(str(skill_id), approved_by=user.user_id)
    if not ok:
        raise HTTPException(404, 'Skill not found or has no versions')
    return {'approved': True}


@router.post('/{skill_id}/deprecate')
async def deprecate_skill(skill_id: UUID, user: AdminUser):
    await _manager.deprecate_skill(str(skill_id))
    return {'deprecated': True}


# ── Marketplace (SkillsMP) ────────────────────────────────────────────────────

class SkillImportInput(BaseModel):
    id: str
    name: str
    description: str
    github_url: str
    author: str | None = None
    category: str | None = None


@router.get('/marketplace/search')
async def marketplace_search(
    user: CurrentUser,
    q: str = Query(..., description="Search query"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort_by: str | None = Query(None),
    category: str | None = Query(None),
):
    """Search the SkillsMP marketplace."""
    try:
        return await search_marketplace(
            q, page=page, limit=limit,
            sort_by=sort_by, category=category,
        )
    except Exception as exc:
        raise HTTPException(502, f'Marketplace unavailable: {exc}') from exc


@router.post('/marketplace/import')
async def marketplace_import(body: SkillImportInput, db: DB, user: AdminUser):
    """Import a skill from SkillsMP into the local skills catalog as a draft."""
    slug = re.sub(r'[^a-z0-9]+', '-', body.name.lower()).strip('-')
    existing = await db.execute(select(Skill).where(Skill.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"A skill with slug '{slug}' already exists.")

    content = await fetch_skill_content(body.github_url)
    if not content:
        content = f"# {body.name}\n\n{body.description}\n\nSource: {body.github_url}\n"

    skill = Skill(
        name=body.name,
        slug=slug,
        description=body.description,
        category=body.category,
        approval_status='draft',
        is_global=False,
        tenant_id=user.tenant_id,
    )
    db.add(skill)
    await db.flush()

    version = SkillVersion(
        skill_id=skill.id,
        version=1,
        content=content,
    )
    db.add(version)
    await db.flush()
    await db.commit()
    await db.refresh(skill)

    return {
        'id': str(skill.id),
        'name': skill.name,
        'slug': skill.slug,
        'approval_status': skill.approval_status,
        'created_at': skill.created_at.isoformat() if skill.created_at else None,
        'source': 'skillsmp',
        'source_id': body.id,
    }
