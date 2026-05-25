from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import Date as SQLDate
from sqlalchemy import Integer, and_, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.agent import Agent, AgentRun
from conflux.models.user import User

router = APIRouter()


class DailyRunCount(BaseModel):
    date: str
    count: int


class TopAgentStat(BaseModel):
    agent_id: str
    agent_name: str
    run_count: int


class InsightsResponse(BaseModel):
    total_runs: int
    runs_by_status: dict[str, int] = Field(default_factory=dict)
    total_tokens: int
    runs_last_30_days: list[DailyRunCount] = Field(default_factory=list)
    top_agents: list[TopAgentStat] = Field(default_factory=list)
    avg_response_time_ms: float


class AdminInsightsResponse(InsightsResponse):
    total_users: int
    active_users_30d: int
    system_total_runs: int
    system_total_tokens: int
    system_runs_by_status: dict[str, int] = Field(default_factory=dict)
    user_runs_last_30_days: list[DailyRunCount] = Field(default_factory=list)
    user_top_agents: list[TopAgentStat] = Field(default_factory=list)


def _token_total_expr():
    prompt_tokens = func.coalesce(cast(AgentRun.token_usage['prompt_tokens'].astext, Integer), 0)
    completion_tokens = func.coalesce(cast(AgentRun.token_usage['completion_tokens'].astext, Integer), 0)
    return prompt_tokens + completion_tokens


async def build_insights_snapshot(
    db: AsyncSession,
    *,
    user_id: UUID | None = None,
) -> dict:
    filters = []
    if user_id is not None:
        filters.append(AgentRun.user_id == user_id)

    duration_expr = func.extract('epoch', AgentRun.completed_at - AgentRun.started_at) * 1000.0
    overview = (
        await db.execute(
            select(
                func.count(AgentRun.id).label('total_runs'),
                func.coalesce(func.sum(case((AgentRun.status == 'completed', 1), else_=0)), 0).label(
                    'completed_runs'
                ),
                func.coalesce(func.sum(case((AgentRun.status == 'failed', 1), else_=0)), 0).label(
                    'failed_runs'
                ),
                func.coalesce(func.sum(case((AgentRun.status == 'running', 1), else_=0)), 0).label(
                    'running_runs'
                ),
                func.coalesce(func.sum(_token_total_expr()), 0).label('total_tokens'),
                func.avg(
                    case(
                        (
                            and_(
                                AgentRun.status == 'completed',
                                AgentRun.started_at.is_not(None),
                                AgentRun.completed_at.is_not(None),
                            ),
                            duration_expr,
                        ),
                        else_=None,
                    )
                ).label('avg_response_time_ms'),
            ).where(*filters)
        )
    ).mappings().one()

    start_date = datetime.now(timezone.utc).date() - timedelta(days=29)
    day_column = cast(func.date(AgentRun.created_at), SQLDate)
    series_result = await db.execute(
        select(day_column.label('day'), func.count(AgentRun.id).label('count'))
        .where(*filters, day_column >= start_date)
        .group_by(day_column)
        .order_by(day_column)
    )
    series_rows = series_result.all()
    counts_by_day = {
        (row.day.isoformat() if isinstance(row.day, date) else str(row.day)): int(row.count)
        for row in series_rows
    }
    runs_last_30_days = [
        {'date': current_day.isoformat(), 'count': counts_by_day.get(current_day.isoformat(), 0)}
        for current_day in (start_date + timedelta(days=offset) for offset in range(30))
    ]

    top_agents_result = await db.execute(
        select(
            Agent.id.label('agent_id'),
            Agent.name.label('agent_name'),
            func.count(AgentRun.id).label('run_count'),
        )
        .select_from(AgentRun)
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(*filters)
        .group_by(Agent.id, Agent.name)
        .order_by(func.count(AgentRun.id).desc(), Agent.name.asc())
        .limit(5)
    )
    top_agents = [
        {
            'agent_id': str(row.agent_id),
            'agent_name': row.agent_name,
            'run_count': int(row.run_count),
        }
        for row in top_agents_result.all()
    ]

    return {
        'total_runs': int(overview['total_runs'] or 0),
        'runs_by_status': {
            'completed': int(overview['completed_runs'] or 0),
            'failed': int(overview['failed_runs'] or 0),
            'running': int(overview['running_runs'] or 0),
        },
        'total_tokens': int(overview['total_tokens'] or 0),
        'runs_last_30_days': runs_last_30_days,
        'top_agents': top_agents,
        'avg_response_time_ms': round(float(overview['avg_response_time_ms'] or 0), 2),
    }


async def build_user_insights_summary(db: AsyncSession, user_id: UUID) -> str:
    snapshot = await build_insights_snapshot(db, user_id=user_id)
    total_runs = snapshot['total_runs']
    completed_runs = snapshot['runs_by_status'].get('completed', 0)
    failed_runs = snapshot['runs_by_status'].get('failed', 0)
    running_runs = snapshot['runs_by_status'].get('running', 0)
    success_rate = (completed_runs / total_runs * 100.0) if total_runs else 0.0
    recent_runs = sum(day['count'] for day in snapshot['runs_last_30_days'])
    avg_response_time_ms = snapshot['avg_response_time_ms']
    top_agents = ', '.join(
        f"{agent['agent_name']} ({agent['run_count']})" for agent in snapshot['top_agents']
    ) or 'No runs yet'
    avg_text = f'{avg_response_time_ms:,.0f} ms' if avg_response_time_ms > 0 else '—'

    return (
        'Insights snapshot\n'
        f'- Total runs: {total_runs:,}\n'
        f'- Completed: {completed_runs:,} · Failed: {failed_runs:,} · Running: {running_runs:,}\n'
        f'- Success rate: {success_rate:.1f}%\n'
        f'- Total tokens: {snapshot["total_tokens"]:,}\n'
        f'- Avg response time: {avg_text}\n'
        f'- Runs in last 30 days: {recent_runs:,}\n'
        f'- Top agents: {top_agents}'
    )


@router.get('/insights', response_model=InsightsResponse)
async def get_insights(db: DB, user: CurrentUser):
    return await build_insights_snapshot(db, user_id=UUID(user.user_id))


@router.get('/admin/insights', response_model=AdminInsightsResponse)
async def get_admin_insights(db: DB, user: AdminUser):
    user_snapshot = await build_insights_snapshot(db, user_id=UUID(user.user_id))
    system_snapshot = await build_insights_snapshot(db)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    active_users_30d = (
        await db.execute(
            select(func.count(func.distinct(AgentRun.user_id))).where(
                AgentRun.user_id.is_not(None),
                AgentRun.created_at >= cutoff,
            )
        )
    ).scalar_one()

    return {
        **user_snapshot,
        'runs_last_30_days': system_snapshot['runs_last_30_days'],
        'top_agents': system_snapshot['top_agents'],
        'total_users': int(total_users or 0),
        'active_users_30d': int(active_users_30d or 0),
        'system_total_runs': system_snapshot['total_runs'],
        'system_total_tokens': system_snapshot['total_tokens'],
        'system_runs_by_status': system_snapshot['runs_by_status'],
        'user_runs_last_30_days': user_snapshot['runs_last_30_days'],
        'user_top_agents': user_snapshot['top_agents'],
    }
