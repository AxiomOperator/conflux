"""Agent CRUD routes."""
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.core.config import get_settings
from conflux.models.agent import Agent, AgentRun

router = APIRouter()


class AgentCreate(BaseModel):
    name: str
    agent_type: str = 'worker'
    description: str | None = None
    system_prompt: str
    model_policy: dict = Field(default_factory=dict)
    tool_allowlist: list[str] = Field(default_factory=list)
    retrieval_tags: list[str] = Field(default_factory=list)
    max_iterations: int = 20
    wiki_rag_enabled: bool = Field(
        default_factory=lambda: get_settings().wiki_rag_enabled_default
    )


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    model_policy: dict | None = None
    tool_allowlist: list[str] | None = None
    is_enabled: bool | None = None
    wiki_rag_enabled: bool | None = None


def _agent_dict(agent: Agent, active_runs: int = 0) -> dict:
    return {
        'id': str(agent.id),
        'name': agent.name,
        'slug': agent.slug,
        'type': agent.agent_type,
        'description': agent.description,
        'status': 'active' if agent.is_enabled else 'disabled',
        'is_enabled': agent.is_enabled,
        'tool_allowlist': agent.tool_allowlist or [],
        'model_policy': agent.model_policy or {},
        'max_iterations': agent.max_iterations,
        'wiki_rag_enabled': agent.wiki_rag_enabled,
        'created_at': agent.created_at.isoformat() if agent.created_at else None,
        'active_runs': active_runs,
    }


@router.get('')
async def list_agents(db: DB, user: CurrentUser):
    result = await db.execute(select(Agent).where(Agent.is_enabled.is_(True)))
    agents = result.scalars().all()

    # Get active run counts per agent
    run_counts_result = await db.execute(
        select(AgentRun.agent_id, func.count(AgentRun.id))
        .where(AgentRun.status == 'running')
        .group_by(AgentRun.agent_id)
    )
    run_counts = dict(run_counts_result.fetchall())

    return [_agent_dict(a, run_counts.get(a.id, 0)) for a in agents]


@router.post('', status_code=201)
async def create_agent(body: AgentCreate, db: DB, user: AdminUser):
    from slugify import slugify

    agent = Agent(
        name=body.name,
        slug=slugify(body.name),
        agent_type=body.agent_type,
        description=body.description,
        system_prompt=body.system_prompt,
        model_policy=body.model_policy,
        tool_allowlist=body.tool_allowlist,
        retrieval_tags=body.retrieval_tags,
        max_iterations=body.max_iterations,
        wiki_rag_enabled=body.wiki_rag_enabled,
        created_by=UUID(user.user_id),
    )
    db.add(agent)
    await db.flush()
    return {
        'id': str(agent.id),
        'name': agent.name,
        'slug': agent.slug,
        'wiki_rag_enabled': agent.wiki_rag_enabled,
    }


@router.get('/colony')
async def get_colony(db: DB, user: CurrentUser):
    """Return the full agent colony state: agents, active runs, recent delegations."""
    agents_result = await db.execute(select(Agent))
    agents = agents_result.scalars().all()

    # Active runs per agent
    run_counts_result = await db.execute(
        select(AgentRun.agent_id, func.count(AgentRun.id))
        .where(AgentRun.status == 'running')
        .group_by(AgentRun.agent_id)
    )
    run_counts = dict(run_counts_result.fetchall())

    # Total runs per agent
    total_counts_result = await db.execute(
        select(AgentRun.agent_id, func.count(AgentRun.id))
        .group_by(AgentRun.agent_id)
    )
    total_counts = dict(total_counts_result.fetchall())

    # Recent runs with parent_run_id for delegation view (last 50)
    recent_runs_result = await db.execute(
        select(AgentRun)
        .order_by(AgentRun.created_at.desc())
        .limit(50)
    )
    recent_runs = recent_runs_result.scalars().all()

    run_data = [
        {
            'id': str(r.id),
            'agent_id': str(r.agent_id),
            'status': r.status,
            'parent_run_id': str(r.parent_run_id) if r.parent_run_id else None,
            'created_at': r.created_at.isoformat() if r.created_at else None,
        }
        for r in recent_runs
    ]

    return {
        'agents': [
            {
                **_agent_dict(a, run_counts.get(a.id, 0)),
                'total_runs': total_counts.get(a.id, 0),
            }
            for a in agents
        ],
        'recent_runs': run_data,
    }


@router.get('/{agent_id}')
async def get_agent(agent_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, 'Agent not found')
    return {
        'id': str(agent.id),
        'name': agent.name,
        'type': agent.agent_type,
        'system_prompt': agent.system_prompt,
        'model_policy': agent.model_policy,
        'tool_allowlist': agent.tool_allowlist,
        'wiki_rag_enabled': agent.wiki_rag_enabled,
    }


@router.patch('/{agent_id}')
async def update_agent(agent_id: UUID, body: AgentUpdate, db: DB, user: AdminUser):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, 'Agent not found')
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    return {'id': str(agent.id), 'updated': True}


@router.delete('/{agent_id}', status_code=204)
async def delete_agent(agent_id: UUID, db: DB, user: AdminUser):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, 'Agent not found')
    await db.delete(agent)
