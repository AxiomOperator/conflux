"""Scheduled task REST routes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.agent import Agent, AgentRun
from conflux.models.schedule import ScheduledTask
from conflux.scheduler.cron_parser import next_run_time, parse_schedule, validate_cron

router = APIRouter()

_SCHEDULE_META_KEY = '_conflux_schedule'


class ScheduleCreate(BaseModel):
    name: str
    agent_id: UUID
    schedule: str
    nl_schedule: str | None = None
    input_template: dict[str, Any] = Field(default_factory=dict)
    channel: str = 'api'
    enabled: bool = True
    next_run: datetime | None = Field(default=None, exclude=True)

    @model_validator(mode='after')
    def normalize_schedule(self) -> 'ScheduleCreate':
        self.schedule, self.nl_schedule, self.next_run = _normalize_schedule_fields(
            self.schedule,
            self.nl_schedule,
        )
        return self


class ScheduleUpdate(BaseModel):
    name: str | None = None
    agent_id: UUID | None = None
    schedule: str | None = None
    nl_schedule: str | None = None
    input_template: dict[str, Any] | None = None
    channel: str | None = None
    enabled: bool | None = None
    next_run: datetime | None = Field(default=None, exclude=True)

    @model_validator(mode='after')
    def normalize_schedule(self) -> 'ScheduleUpdate':
        if self.schedule is None:
            self.nl_schedule = _normalize_optional_text(self.nl_schedule)
            return self
        self.schedule, self.nl_schedule, self.next_run = _normalize_schedule_fields(
            self.schedule,
            self.nl_schedule,
        )
        return self


class ScheduleResponse(BaseModel):
    id: UUID
    user_id: UUID | None
    created_by: UUID | None
    agent_id: UUID
    name: str
    schedule: str
    cron_expr: str
    nl_schedule: str | None
    input_template: dict[str, Any] = Field(default_factory=dict)
    channel: str | None
    channel_target: str | None
    enabled: bool
    is_enabled: bool
    last_run: datetime | None
    next_run: datetime | None
    last_status: str | None
    run_count: int = 0
    created_at: datetime | None
    updated_at: datetime | None


class RunResponse(BaseModel):
    id: UUID
    status: str
    agent_id: UUID
    input: dict[str, Any]
    output: dict[str, Any] | None
    token_usage: dict[str, Any] | None
    created_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None


async def _get_agent_or_404(db: DB, agent_id: UUID) -> Agent:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, 'Agent not found')
    return agent


async def _get_schedule_or_404(db: DB, schedule_id: UUID) -> ScheduledTask:
    result = await db.execute(select(ScheduledTask).where(ScheduledTask.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(404, 'Schedule not found')
    return schedule


def _ensure_schedule_access(schedule: ScheduledTask, user: CurrentUser | AdminUser) -> None:
    if schedule.created_by and str(schedule.created_by) == user.user_id:
        return
    if user.is_admin:
        return
    raise HTTPException(403, 'Forbidden')


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _normalize_schedule_fields(
    schedule: str,
    nl_schedule: str | None,
) -> tuple[str, str | None, datetime]:
    raw = schedule.strip()
    if not raw:
        raise ValueError('schedule cannot be empty')

    normalized_nl = _normalize_optional_text(nl_schedule)
    cron_expr = raw
    if not validate_cron(raw):
        cron_expr = parse_schedule(raw)
        if normalized_nl is None:
            normalized_nl = raw

    return cron_expr, normalized_nl, next_run_time(cron_expr)


def _public_input_template(schedule: ScheduledTask) -> dict[str, Any]:
    template = dict(schedule.input_template or {})
    template.pop(_SCHEDULE_META_KEY, None)
    return template


def _stored_nl_schedule(schedule: ScheduledTask) -> str | None:
    meta = (schedule.input_template or {}).get(_SCHEDULE_META_KEY)
    if isinstance(meta, dict):
        return _normalize_optional_text(meta.get('nl_schedule'))
    return None


def _build_input_template(input_template: dict[str, Any] | None, nl_schedule: str | None) -> dict[str, Any]:
    template = dict(input_template or {})
    template.pop(_SCHEDULE_META_KEY, None)
    normalized_nl = _normalize_optional_text(nl_schedule)
    if normalized_nl is not None:
        template[_SCHEDULE_META_KEY] = {'nl_schedule': normalized_nl}
    return template


async def _schedule_run_counts(db: DB, schedules: list[ScheduledTask]) -> dict[str, int]:
    if not schedules:
        return {}

    schedule_ids = {str(schedule.id) for schedule in schedules}
    agent_ids = {schedule.agent_id for schedule in schedules}
    result = await db.execute(select(AgentRun.input).where(AgentRun.agent_id.in_(agent_ids)))

    counts = {schedule_id: 0 for schedule_id in schedule_ids}
    for payload in result.scalars():
        if not isinstance(payload, dict):
            continue
        schedule_id = payload.get('scheduled_task_id')
        if schedule_id in counts:
            counts[schedule_id] += 1
    return counts


def _schedule_response(schedule: ScheduledTask, run_count: int = 0) -> ScheduleResponse:
    return ScheduleResponse(
        id=schedule.id,
        user_id=schedule.created_by,
        created_by=schedule.created_by,
        agent_id=schedule.agent_id,
        name=schedule.name,
        schedule=schedule.cron_expr,
        cron_expr=schedule.cron_expr,
        nl_schedule=_stored_nl_schedule(schedule),
        input_template=_public_input_template(schedule),
        channel=schedule.channel,
        channel_target=schedule.channel_target,
        enabled=schedule.is_enabled,
        is_enabled=schedule.is_enabled,
        last_run=schedule.last_run,
        next_run=schedule.next_run,
        last_status=schedule.last_status,
        run_count=run_count,
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
    )


def _run_response(run: AgentRun) -> RunResponse:
    return RunResponse(
        id=run.id,
        status=run.status,
        agent_id=run.agent_id,
        input=run.input or {},
        output=run.output,
        token_usage=run.token_usage,
        created_at=run.created_at,
        started_at=run.started_at,
        completed_at=run.completed_at,
    )


@router.get('', response_model=list[ScheduleResponse])
async def list_schedules(db: DB, user: CurrentUser):
    stmt = select(ScheduledTask).order_by(ScheduledTask.created_at.desc())
    if not user.is_admin:
        stmt = stmt.where(ScheduledTask.created_by == UUID(user.user_id))

    result = await db.execute(stmt)
    schedules = result.scalars().all()
    run_counts = await _schedule_run_counts(db, schedules)
    return [_schedule_response(schedule, run_counts.get(str(schedule.id), 0)) for schedule in schedules]


@router.post('', status_code=201, response_model=ScheduleResponse)
async def create_schedule(body: ScheduleCreate, db: DB, user: CurrentUser):
    await _get_agent_or_404(db, body.agent_id)

    schedule = ScheduledTask(
        agent_id=body.agent_id,
        created_by=UUID(user.user_id),
        name=body.name,
        cron_expr=body.schedule,
        input_template=_build_input_template(body.input_template, body.nl_schedule),
        channel=body.channel,
        is_enabled=body.enabled,
        next_run=body.next_run,
    )
    db.add(schedule)
    await db.flush()
    await db.refresh(schedule)
    return _schedule_response(schedule)


@router.get('/{schedule_id}', response_model=ScheduleResponse)
async def get_schedule(schedule_id: UUID, db: DB, user: CurrentUser):
    schedule = await _get_schedule_or_404(db, schedule_id)
    _ensure_schedule_access(schedule, user)
    run_counts = await _schedule_run_counts(db, [schedule])
    return _schedule_response(schedule, run_counts.get(str(schedule.id), 0))


@router.patch('/{schedule_id}', response_model=ScheduleResponse)
async def update_schedule(schedule_id: UUID, body: ScheduleUpdate, db: DB, user: CurrentUser):
    schedule = await _get_schedule_or_404(db, schedule_id)
    _ensure_schedule_access(schedule, user)

    if body.agent_id is not None:
        await _get_agent_or_404(db, body.agent_id)
        schedule.agent_id = body.agent_id
    if body.name is not None:
        schedule.name = body.name
    if body.schedule is not None:
        schedule.cron_expr = body.schedule
        schedule.next_run = body.next_run
    if body.channel is not None:
        schedule.channel = body.channel
    if body.enabled is not None:
        schedule.is_enabled = body.enabled

    current_template = _public_input_template(schedule)
    if 'input_template' in body.model_fields_set:
        current_template = body.input_template or {}

    current_nl = _stored_nl_schedule(schedule)
    if body.schedule is not None:
        current_nl = body.nl_schedule
    elif 'nl_schedule' in body.model_fields_set:
        current_nl = body.nl_schedule

    if body.schedule is not None or 'input_template' in body.model_fields_set or 'nl_schedule' in body.model_fields_set:
        schedule.input_template = _build_input_template(current_template, current_nl)

    await db.flush()
    await db.refresh(schedule)
    run_counts = await _schedule_run_counts(db, [schedule])
    return _schedule_response(schedule, run_counts.get(str(schedule.id), 0))


@router.delete('/{schedule_id}', status_code=204)
async def delete_schedule(schedule_id: UUID, db: DB, user: CurrentUser):
    schedule = await _get_schedule_or_404(db, schedule_id)
    _ensure_schedule_access(schedule, user)
    await db.delete(schedule)


@router.post('/{schedule_id}/run-now', status_code=201, response_model=RunResponse)
async def run_schedule_now(schedule_id: UUID, db: DB, user: CurrentUser):
    schedule = await _get_schedule_or_404(db, schedule_id)
    _ensure_schedule_access(schedule, user)

    agent = await _get_agent_or_404(db, schedule.agent_id)
    if not agent.is_enabled:
        raise HTTPException(400, 'Agent is disabled')

    now = datetime.now(timezone.utc)
    messages = _public_input_template(schedule).get('messages', [])
    if not messages:
        messages = [
            {
                'role': 'user',
                'content': f'Scheduled run triggered at {now.isoformat()}',
            }
        ]

    run = AgentRun(
        id=uuid4(),
        agent_id=agent.id,
        user_id=schedule.created_by,
        status='queued',
        input={'messages': messages, 'scheduled_task_id': str(schedule.id)},
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    return _run_response(run)
