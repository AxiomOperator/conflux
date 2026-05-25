"""Skill management tools — agents can read and draft skills."""
from __future__ import annotations

from sqlalchemy import select
from slugify import slugify

from conflux.tools.registry import ToolDefinition, ToolRegistry


async def _skill_list(args: dict, context) -> dict:
    """List available skills (progressive disclosure level 0)."""
    from conflux.core.database import get_db_session
    from conflux.models.skill import Skill

    async with get_db_session() as db:
        stmt = (
            select(Skill.name, Skill.slug, Skill.description, Skill.category)
            .where(Skill.approval_status == "approved")
            .limit(50)
        )
        result = await db.execute(stmt)
        skills = result.all()

    return {
        "skills": [
            {
                "name": skill.name,
                "slug": skill.slug,
                "description": skill.description,
                "category": skill.category,
            }
            for skill in skills
        ]
    }


async def _skill_read(args: dict, context) -> dict:
    """Read a skill's full content (progressive disclosure level 1)."""
    slug = str(args.get("slug", "")).strip()
    if not slug:
        return {"error": "slug is required"}

    from conflux.core.database import get_db_session
    from conflux.models.skill import Skill, SkillVersion

    async with get_db_session() as db:
        result = await db.execute(select(Skill).where(Skill.slug == slug))
        skill = result.scalar_one_or_none()
        if not skill:
            return {"error": f"Skill not found: {slug}"}

        content = ""
        if skill.active_version_id:
            version_result = await db.execute(
                select(SkillVersion).where(SkillVersion.id == skill.active_version_id)
            )
            version = version_result.scalar_one_or_none()
            if version is not None:
                content = version.content

    return {
        "name": skill.name,
        "slug": skill.slug,
        "description": skill.description,
        "content": content,
    }


async def _skill_draft(args: dict, context) -> dict:
    """Draft a new skill from a successful workflow."""
    name = str(args.get("name", "")).strip()
    description = str(args.get("description", "")).strip()
    content = str(args.get("content", "")).strip()
    category = str(args.get("category", "general")).strip() or "general"

    if not all([name, description, content]):
        return {"error": "name, description, and content are required"}

    from conflux.core.database import get_db_session
    from conflux.models.skill import Skill, SkillVersion

    slug = slugify(name)

    async with get_db_session() as db:
        existing = await db.execute(select(Skill).where(Skill.slug == slug))
        if existing.scalar_one_or_none() is not None:
            return {"error": f"Skill already exists: {slug}"}

        skill = Skill(
            name=name,
            slug=slug,
            description=description,
            category=category,
            approval_status="draft",
            owner_user_id=context.user_id,
            tenant_id=context.tenant_id,
            project_id=context.project_id,
        )
        db.add(skill)
        await db.flush()

        version = SkillVersion(
            skill_id=skill.id,
            version=1,
            content=content,
            change_summary="Initial draft by agent",
        )
        db.add(version)
        await db.flush()

        skill.active_version_id = version.id

    return {
        "status": "drafted",
        "slug": slug,
        "message": "Skill saved as draft, pending approval",
    }


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="skill_list",
            description="List available approved skills by name and description.",
            parameters={
                "type": "object",
                "properties": {
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [],
                    }
                },
            },
            risk_level="safe",
            fn=_skill_list,
        )
    )
    registry.register(
        ToolDefinition(
            name="skill_read",
            description="Read the full content of a skill by slug.",
            parameters={
                "type": "object",
                "properties": {"slug": {"type": "string"}},
                "required": ["slug"],
            },
            risk_level="safe",
            fn=_skill_read,
        )
    )
    registry.register(
        ToolDefinition(
            name="skill_draft",
            description="Draft a new skill from a successful workflow. Creates a draft pending admin approval.",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "content": {
                        "type": "string",
                        "description": "Full SKILL.md markdown content",
                    },
                    "category": {"type": "string", "default": "general"},
                },
                "required": ["name", "description", "content"],
            },
            risk_level="safe",
            fn=_skill_draft,
        )
    )
