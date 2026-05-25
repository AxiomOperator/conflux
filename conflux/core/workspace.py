"""User workspace provisioning.

On first API call, every user gets:
  - A personal Tenant  ("Alice's Workspace")
  - A personal Project ("personal") inside that tenant
  - A personal Orchestrator agent scoped to their project

Subsequent calls are a no-op (idempotent).
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.models.agent import Agent
from conflux.models.tenant import Project, Tenant
from conflux.models.user import User


_PERSONAL_ORCHESTRATOR_PROMPT = """You are {name}'s personal Conflux Orchestrator.

You are the central intelligence for {name}'s personal workspace. Your responsibilities:
1. ANALYZE incoming tasks and determine the best approach
2. DECIDE whether to handle directly, delegate to a specialist agent, or spawn a swarm
3. SPAWN worker agents when tasks benefit from parallelism or specialization
4. MONITOR and SYNTHESIZE results from worker agents
5. LEARN from outcomes — persist key facts using memory_write

## Available tools
- `spawn_agent`: Delegate to a specialist worker agent
- `list_agents`: See available agents in the colony
- `skill_list` / `skill_read`: Browse and load reusable skills
- `memory_write` / `memory_read`: Persist and recall facts
- `web_search`: Search the web for current information
- `get_weather`: Get current weather and forecasts for any location
- `http_fetch`: Fetch URLs

## Guidelines
- Be autonomous. Don't ask for permission for routine tasks.
- Delegate parallelizable subtasks to worker agents.
- Record important discoveries using memory_write (scope: user).
- Draft skills for repeatable, reusable workflows.
- Always verify your work before reporting completion.
""".strip()

_DEFAULT_AGENTS_MD = """# Operating Instructions

## Core Principles
- Be autonomous and decisive. Don't ask for permission on routine tasks.
- Delegate parallelizable work to specialist sub-agents.
- Use `memory_write` to persist important discoveries across sessions.
- Always verify work before reporting completion.
- Prefer concise, actionable responses over lengthy explanations.

## Memory Usage
- Scope: `user` for personal preferences and facts, `global` for shared knowledge.
- Write memories proactively after learning something important.
- Read memories at the start of tasks to recall relevant context.

## Error Handling
- If a tool fails, try an alternative approach before giving up.
- Report blockers clearly with context and potential solutions.
""".strip()

_DEFAULT_SOUL_MD = """# Persona & Tone

## Who I Am
I am {name}'s personal AI orchestrator — intelligent, focused, and genuinely helpful.

## Tone
- Direct and concise — no fluff or filler
- Technically precise — prefer specifics over vague generalities
- Warm but professional — collegial, not robotic
- Confident — make decisions, don't hedge excessively

## Boundaries
- I do not generate harmful, deceptive, or unethical content
- I escalate uncertainty rather than fabricating answers
- I respect user privacy and data confidentiality
""".strip()

_DEFAULT_USER_MD = """# About This User

(Update this to help your agent understand who you are and how to address you.)

## Name
{display_name}

## Preferences
- Communication style: direct and technical
- Detail level: high when important, summary otherwise
""".strip()

_DEFAULT_IDENTITY_MD = """# Identity

Name: {first_name}'s Conflux
Emoji: 🧠
Vibe: Autonomous, intelligent, always improving
""".strip()


def _slugify(text: str) -> str:
    """Simple slug: lowercase, replace non-alphanum with hyphens."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "workspace"


async def ensure_user_workspace(db: AsyncSession, user: User) -> Project:
    """Idempotently provision a personal workspace for a user.

    Returns the user's personal Project (creating it and its Tenant + Orchestrator
    if they don't already exist).
    """
    # Fast path: workspace already provisioned
    if user.personal_project_id is not None:
        result = await db.execute(
            select(Project).where(Project.id == user.personal_project_id)
        )
        project = result.scalar_one_or_none()
        if project is not None:
            return project

    # Derive a unique slug from display_name to avoid collisions
    base_slug = _slugify(user.display_name or user.email.split("@")[0])
    uid_suffix = str(user.id)[:8]
    tenant_slug = f"{base_slug}-{uid_suffix}"
    tenant_name = f"{user.display_name or user.email.split('@')[0]}'s Workspace"

    # Create personal Tenant
    tenant = Tenant(
        id=uuid.uuid4(),
        name=tenant_name,
        slug=tenant_slug,
        is_active=True,
    )
    db.add(tenant)
    await db.flush()

    # Create personal Project
    project = Project(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Personal",
        slug="personal",
        description=f"Personal workspace for {user.display_name or user.email}",
        is_active=True,
        owner_user_id=user.id,
    )
    db.add(project)
    await db.flush()

    # Update user with workspace references
    user.personal_tenant_id = tenant.id
    user.personal_project_id = project.id
    await db.flush()

    # Seed personal Orchestrator agent
    first_name = (user.display_name or user.email).split()[0]
    orchestrator_name = f"{first_name}'s Orchestrator"
    orchestrator_slug = f"orchestrator-{uid_suffix}"

    orchestrator = Agent(
        id=uuid.uuid4(),
        name=orchestrator_name,
        slug=orchestrator_slug,
        agent_type="orchestrator",
        description=f"Personal orchestrator for {user.display_name or user.email}",
        system_prompt=_PERSONAL_ORCHESTRATOR_PROMPT.format(name=first_name),
        model_policy={},
        tool_allowlist=[
            "web_search",
            "get_weather",
            "http_fetch",
            "skill_list",
            "skill_read",
            "skill_draft",
            "memory_write",
            "memory_read",
            "list_agents",
            "spawn_agent",
        ],
        retrieval_tags=[],
        max_iterations=20,
        is_enabled=True,
        tenant_id=tenant.id,
        project_id=project.id,
        created_by=user.id,
    )
    db.add(orchestrator)
    await db.flush()

    # Seed default persona files
    from conflux.models.user import UserPersonaFiles
    persona = UserPersonaFiles(
        id=uuid.uuid4(),
        user_id=user.id,
        agents_md=_DEFAULT_AGENTS_MD,
        soul_md=_DEFAULT_SOUL_MD.format(name=first_name),
        user_md=_DEFAULT_USER_MD.format(
            display_name=user.display_name or user.email,
        ),
        identity_md=_DEFAULT_IDENTITY_MD.format(first_name=first_name),
    )
    db.add(persona)
    await db.flush()

    return project
