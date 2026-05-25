"""Agent run management + SSE streaming."""
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from conflux.agents.base import AgentConfig, RunContext
from conflux.agents.compression import compress_run, normalize_messages
from conflux.agents.loop import AgentLoop
from conflux.api.auth import AuthenticatedUser, CurrentUser
from conflux.api.deps import DB
from conflux.api.routes.insights import build_user_insights_summary
from conflux.api.routes.personality import (
    format_personality_confirmation,
    format_personality_presets_message,
    get_user_personality_preset,
    parse_personality_preset,
    set_user_personality_preset,
)
from conflux.core.database import get_db_session
from conflux.models.agent import Agent, AgentRun, RunEvent
from conflux.models.user import User

router = APIRouter()


class RunCreate(BaseModel):
    agent_id: UUID
    messages: list[dict] = Field(default_factory=list)
    session_id: UUID | None = None
    stream: bool = True


class CompressResponse(BaseModel):
    summary: str
    compressed_at: datetime


class RetryResponse(BaseModel):
    run_id: str
    status: str


class UndoResponse(BaseModel):
    success: bool
    run_id: str


def _latest_user_message(messages: list[dict] | None) -> str:
    for message in reversed(messages or []):
        if isinstance(message, dict) and message.get('role') == 'user':
            return str(message.get('content') or '')
    return ''


def _detect_slash_command(messages: list[dict] | None) -> str | None:
    content = _latest_user_message(messages).lstrip()
    if not content.startswith('/'):
        return None
    return content.split(None, 1)[0].lower()


def _chunk_markdown(text: str, size: int = 180) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)] or ['']


async def _update_command_run(
    run_id: UUID,
    status: str,
    *,
    output: dict | None = None,
    error: str | None = None,
) -> None:
    from sqlalchemy import update

    from conflux.core.database import get_db_session

    now = datetime.now(timezone.utc)
    values = {'status': status, 'updated_at': now}
    if status == 'running':
        values['started_at'] = now
    elif status in {'completed', 'failed', 'cancelled'}:
        values['completed_at'] = now
    if output is not None:
        values['output'] = output
    if error is not None:
        values['error'] = error

    async with get_db_session() as session:
        await session.execute(
            update(AgentRun)
            .where(AgentRun.id == run_id)
            .values(**values)
        )


async def _record_command_event(run_id: UUID, event_type: str, sequence: int, payload: dict) -> None:
    from conflux.core.database import get_db_session

    async with get_db_session() as session:
        session.add(
            RunEvent(
                run_id=run_id,
                event_type=event_type,
                sequence=sequence,
                payload=payload,
            )
        )


async def _stream_doctor_command(run_id: UUID):
    from conflux.api.routes.doctor import collect_doctor_report, format_doctor_markdown
    from conflux.core.database import get_db_session

    async def event_generator():
        sequence = 0
        try:
            await _update_command_run(run_id, 'running')
            sequence += 1
            status_payload = {'status': 'running'}
            await _record_command_event(run_id, 'status', sequence, status_payload)
            yield f"event: status\ndata: {json.dumps(status_payload)}\n\n"

            async with get_db_session() as session:
                report = await collect_doctor_report(session)
            markdown = format_doctor_markdown(report)

            for chunk in _chunk_markdown(markdown):
                sequence += 1
                token_payload = {'content': chunk}
                await _record_command_event(run_id, 'token', sequence, token_payload)
                yield f"event: token\ndata: {json.dumps(token_payload)}\n\n"

            await _update_command_run(run_id, 'completed', output={'content': markdown})
            sequence += 1
            done_payload = {'content': markdown}
            await _record_command_event(run_id, 'done', sequence, done_payload)
            yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
        except Exception as exc:
            message = str(exc)
            await _update_command_run(run_id, 'failed', error=message)
            sequence += 1
            error_payload = {'message': message}
            await _record_command_event(run_id, 'error', sequence, error_payload)
            yield f"event: error\ndata: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


async def _stream_insights_command(run_id: UUID, user_id: str):
    from conflux.core.database import get_db_session

    async def event_generator():
        sequence = 0
        try:
            await _update_command_run(run_id, 'running')
            async with get_db_session() as session:
                summary = await build_user_insights_summary(session, UUID(user_id))
            await _update_command_run(
                run_id,
                'completed',
                output={'content': summary, 'slash_command': 'insights'},
            )
            sequence += 1
            tool_result_payload = {'name': 'insights', 'result': summary}
            await _record_command_event(run_id, 'tool_result', sequence, tool_result_payload)
            yield f"event: tool_result\ndata: {json.dumps(tool_result_payload)}\n\n"
            sequence += 1
            done_payload = {'content': summary}
            await _record_command_event(run_id, 'done', sequence, done_payload)
            yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
        except Exception as exc:
            message = str(exc)
            await _update_command_run(run_id, 'failed', error=message)
            sequence += 1
            error_payload = {'message': message}
            await _record_command_event(run_id, 'error', sequence, error_payload)
            yield f"event: error\ndata: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


def _ensure_run_access(run: AgentRun, user: AuthenticatedUser) -> None:
    if run.user_id and str(run.user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')


def _truncate_payload(payload: object | None, limit: int = 200) -> str | None:
    if payload is None:
        return None
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return text if len(text) <= limit else f'{text[: limit - 1]}…'


def _extract_personality_command_arg(messages: list[dict]) -> str | None:
    for message in reversed(messages):
        if message.get('role') != 'user':
            continue
        content = str(message.get('content', '')).strip()
        if not content:
            return None
        parts = content.split(None, 1)
        if parts[0] != '/personality':
            return None
        return parts[1].strip() if len(parts) > 1 else ''
    return None


async def _handle_personality_slash_command(user_id: str, command_arg: str) -> str:
    user_uuid = UUID(user_id)
    async with get_db_session() as session:
        if not command_arg:
            current_preset = await get_user_personality_preset(session, user_uuid)
            return format_personality_presets_message(current_preset)
        try:
            preset = parse_personality_preset(command_arg)
        except ValueError:
            current_preset = await get_user_personality_preset(session, user_uuid)
            return (
                f'Unknown personality preset: `{command_arg.strip()}`.\n\n'
                f'{format_personality_presets_message(current_preset)}'
            )
        updated_preset = await set_user_personality_preset(session, user_uuid, preset)
        return format_personality_confirmation(updated_preset)


async def _stream_personality_command(
    run_id: UUID,
    user_id: str,
    messages: list[dict] | None,
):
    command_arg = _extract_personality_command_arg(messages or []) or ''

    async def event_generator():
        sequence = 0
        try:
            await _update_command_run(run_id, 'running')
            sequence += 1
            status_payload = {'status': 'running'}
            await _record_command_event(run_id, 'status', sequence, status_payload)
            yield f"event: status\ndata: {json.dumps(status_payload)}\n\n"

            markdown = await _handle_personality_slash_command(user_id, command_arg)
            for chunk in _chunk_markdown(markdown):
                sequence += 1
                token_payload = {'content': chunk}
                await _record_command_event(run_id, 'token', sequence, token_payload)
                yield f"event: token\ndata: {json.dumps(token_payload)}\n\n"

            await _update_command_run(run_id, 'completed', output={'content': markdown})
            sequence += 1
            done_payload = {'content': markdown}
            await _record_command_event(run_id, 'done', sequence, done_payload)
            yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
        except Exception as exc:
            message = str(exc)
            await _update_command_run(run_id, 'failed', error=message)
            sequence += 1
            error_payload = {'message': message}
            await _record_command_event(run_id, 'error', sequence, error_payload)
            yield f"event: error\ndata: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


async def _load_agent(db: DB, agent_id: UUID) -> Agent:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, 'Agent not found')
    if not agent.is_enabled:
        raise HTTPException(400, 'Agent is disabled')
    return agent


async def _create_run_record(
    db: DB,
    *,
    agent_id: UUID,
    user_id: UUID,
    session_id: UUID | None,
    messages: list[dict],
    slash_command: str | None = None,
) -> AgentRun:
    run_input: dict[str, object] = {'messages': messages}
    if slash_command:
        run_input['slash_command'] = slash_command

    run = AgentRun(
        id=uuid4(),
        agent_id=agent_id,
        user_id=user_id,
        session_id=session_id,
        status='queued',
        input=run_input,
    )
    db.add(run)
    await db.flush()
    return run


async def _get_latest_session_run(db: DB, session_id: UUID, user: CurrentUser) -> AgentRun:
    stmt = (
        select(AgentRun)
        .where(
            AgentRun.session_id == session_id,
            AgentRun.is_undone.is_(False),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    if not user.is_admin:
        stmt = stmt.where(AgentRun.user_id == UUID(user.user_id))
    result = await db.execute(stmt)
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    return run


async def _extract_run_messages(db: DB, run: AgentRun) -> list[dict]:
    if isinstance(run.input, dict):
        raw_messages = run.input.get('messages')
        if isinstance(raw_messages, list) and raw_messages:
            return [message for message in raw_messages if isinstance(message, dict)]

    events_result = await db.execute(
        select(RunEvent)
        .where(
            RunEvent.run_id == run.id,
            RunEvent.event_type == 'input',
        )
        .order_by(RunEvent.sequence.asc())
    )
    for event in events_result.scalars().all():
        payload_messages = event.payload.get('messages') if isinstance(event.payload, dict) else None
        if isinstance(payload_messages, list):
            normalized = normalize_messages(payload_messages)
            if normalized:
                return normalized

    raise HTTPException(400, 'Run has no retryable input')


async def _retry_run(db: DB, run: AgentRun, user: CurrentUser) -> AgentRun:
    _ensure_run_access(run, user)
    agent = await _load_agent(db, run.agent_id)
    messages = await _extract_run_messages(db, run)
    return await _create_run_record(
        db,
        agent_id=agent.id,
        user_id=UUID(user.user_id),
        session_id=run.session_id,
        messages=messages,
    )


async def _undo_run(run: AgentRun, user: CurrentUser) -> None:
    _ensure_run_access(run, user)
    run.is_undone = True
    run.status = 'undone'


@router.post('', status_code=201)
async def create_run(body: RunCreate, db: DB, user: CurrentUser):
    """Create and start an agent run. Returns run_id immediately."""
    slash_command = _detect_slash_command(body.messages)
    if slash_command in {'/retry', '/undo'}:
        if not body.session_id:
            raise HTTPException(400, 'Slash commands require a session_id')
        target_run = await _get_latest_session_run(db, body.session_id, user)
        if slash_command == '/retry':
            retried_run = await _retry_run(db, target_run, user)
            return {'run_id': str(retried_run.id), 'status': retried_run.status}
        await _undo_run(target_run, user)
        await db.flush()
        return {'run_id': str(target_run.id), 'status': target_run.status, 'success': True}

    agent = await _load_agent(db, body.agent_id)
    run = await _create_run_record(
        db,
        agent_id=agent.id,
        user_id=UUID(user.user_id),
        session_id=body.session_id,
        messages=body.messages,
        slash_command=slash_command,
    )
    return {'run_id': str(run.id), 'status': run.status}


@router.get('/{run_id}/stream')
async def stream_run(run_id: UUID, db: DB, user: CurrentUser):
    """SSE stream for a run's events."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    _ensure_run_access(run, user)
    if run.is_undone:
        raise HTTPException(400, 'Run has been undone')

    slash_command = run.input.get('slash_command') or _detect_slash_command(run.input.get('messages', []))
    if slash_command == '/doctor':
        return await _stream_doctor_command(run.id)
    if slash_command == '/insights':
        return await _stream_insights_command(run.id, user.user_id)
    if slash_command == '/personality':
        return await _stream_personality_command(run.id, user.user_id, run.input.get('messages', []))

    agent = await _load_agent(db, run.agent_id)

    config = AgentConfig(
        agent_id=str(agent.id),
        name=agent.name,
        agent_type=agent.agent_type,
        system_prompt=agent.system_prompt,
        model_policy=agent.model_policy or {},
        tool_allowlist=agent.tool_allowlist or [],
        retrieval_tags=agent.retrieval_tags or [],
        max_iterations=agent.max_iterations,
        wiki_rag_enabled=agent.wiki_rag_enabled,
    )

    context = RunContext(
        run_id=str(run_id),
        user_id=user.user_id,
        session_id=str(run.session_id) if run.session_id else None,
        tenant_id=user.tenant_id,
        project_id=None,
        input_messages=run.input.get('messages', []),
    )

    async def event_generator():
        loop_inst = AgentLoop(config=config, context=context)
        async for event in loop_inst.run():
            data = json.dumps(event.data)
            yield f'event: {event.event_type}\ndata: {data}\n\n'
        yield 'event: done\ndata: {}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@router.get('/search')
async def search_runs(
    db: DB,
    user: CurrentUser,
    query: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    agent_id: UUID | None = Query(None),
):
    """Full-text search over run input and output within the user's workspace."""
    project_result = await db.execute(
        select(User.personal_project_id).where(User.id == UUID(user.user_id))
    )
    project_id = project_result.scalar_one_or_none()
    if project_id is None:
        return []

    search_query = query.strip()
    if not search_query:
        return []

    ts_query = func.websearch_to_tsquery('english', search_query)
    stmt = (
        select(AgentRun, Agent)
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(
            Agent.project_id == project_id,
            AgentRun.is_undone.is_(False),
            AgentRun.search_vector.op('@@')(ts_query),
        )
    )
    if agent_id is not None:
        stmt = stmt.where(AgentRun.agent_id == agent_id)

    stmt = stmt.order_by(
        func.ts_rank(AgentRun.search_vector, ts_query).desc(),
        AgentRun.created_at.desc(),
    ).limit(limit)

    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            'id': str(run.id),
            'agent_id': str(run.agent_id),
            'agent_name': agent.name,
            'input': _truncate_payload(run.input) or '',
            'output': _truncate_payload(run.output),
            'created_at': run.created_at.isoformat() if run.created_at else None,
            'status': run.status,
        }
        for run, agent in rows
    ]


@router.post('/{run_id}/compress', response_model=CompressResponse)
async def compress_run_endpoint(run_id: UUID, db: DB, user: CurrentUser):
    """Compress a run's conversation history into a reusable summary."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    _ensure_run_access(run, user)

    summary, compressed_at = await compress_run(db, run)
    return {'summary': summary, 'compressed_at': compressed_at}


@router.post('/{run_id}/retry', response_model=RetryResponse)
async def retry_run_endpoint(run_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')

    retried_run = await _retry_run(db, run, user)
    return {'run_id': str(retried_run.id), 'status': retried_run.status}


@router.post('/{run_id}/undo', response_model=UndoResponse)
async def undo_run_endpoint(run_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')

    await _undo_run(run, user)
    await db.flush()
    return {'success': True, 'run_id': str(run.id)}


@router.get('/{run_id}')
async def get_run(run_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    _ensure_run_access(run, user)
    return {
        'id': str(run.id),
        'status': run.status,
        'agent_id': str(run.agent_id),
        'input': run.input,
        'output': run.output,
        'token_usage': run.token_usage,
        'is_compressed': run.is_compressed,
        'is_undone': run.is_undone,
        'compressed_at': run.updated_at.isoformat() if run.is_compressed and run.updated_at else None,
        'created_at': run.created_at.isoformat() if run.created_at else None,
        'started_at': run.started_at.isoformat() if run.started_at else None,
        'completed_at': run.completed_at.isoformat() if run.completed_at else None,
    }


@router.get('/{run_id}/events')
async def get_run_events(run_id: UUID, db: DB, user: CurrentUser):
    """Return stored RunEvents for a completed run, ordered by sequence."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    _ensure_run_access(run, user)

    events_result = await db.execute(
        select(RunEvent)
        .where(RunEvent.run_id == run_id)
        .order_by(RunEvent.sequence)
    )
    events = events_result.scalars().all()
    return [
        {
            'id': str(e.id),
            'event_type': e.event_type,
            'sequence': e.sequence,
            'payload': e.payload,
            'created_at': e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.get('')
async def list_runs(db: DB, user: CurrentUser, limit: int = 20, offset: int = 0):
    stmt = (
        select(AgentRun)
        .where(AgentRun.is_undone.is_(False))
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if not user.is_admin:
        stmt = stmt.where(AgentRun.user_id == UUID(user.user_id))
    result = await db.execute(stmt)
    runs = result.scalars().all()
    return [
        {
            'id': str(run.id),
            'status': run.status,
            'agent_id': str(run.agent_id),
            'is_compressed': run.is_compressed,
            'is_undone': run.is_undone,
            'compressed_at': run.updated_at.isoformat() if run.is_compressed and run.updated_at else None,
            'created_at': run.created_at.isoformat(),
        }
        for run in runs
    ]


@router.post('/{run_id}/cancel')
async def cancel_run(run_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, 'Run not found')
    _ensure_run_access(run, user)
    if run.status not in ('queued', 'running'):
        raise HTTPException(400, f'Cannot cancel run in status: {run.status}')
    run.status = 'cancelled'
    return {'run_id': str(run_id), 'status': 'cancelled'}
