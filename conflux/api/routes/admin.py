"""Admin routes — stats, reflection jobs, evolution candidates."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import Date
from sqlalchemy import cast, func, outerjoin, select, update
from sqlalchemy.dialects.postgresql import insert

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.agent import Agent, AgentRun
from conflux.models.learning import EvolutionCandidate, ReflectionJob
from conflux.models.memory import Memory
from conflux.models.skill import Skill, SkillVersion
from conflux.models.user import UserViewAsSetting

router = APIRouter()


@router.post('/view-as-user')
async def enable_view_as_user(db: DB, user: AdminUser):
    await db.execute(
        insert(UserViewAsSetting)
        .values(user_id=UUID(user.user_id), view_as_user=True)
        .on_conflict_do_update(
            index_elements=['user_id'],
            set_={'view_as_user': True, 'updated_at': func.now()},
        )
    )
    return {'view_as_user': True}


@router.delete('/view-as-user')
async def disable_view_as_user(db: DB, user: AdminUser):
    await db.execute(
        insert(UserViewAsSetting)
        .values(user_id=UUID(user.user_id), view_as_user=False)
        .on_conflict_do_update(
            index_elements=['user_id'],
            set_={'view_as_user': False, 'updated_at': func.now()},
        )
    )
    return {'view_as_user': False}


@router.get('/stats')
async def get_stats(db: DB, user: AdminUser):
    total_runs = (await db.execute(select(func.count(AgentRun.id)))).scalar()
    completed = (
        await db.execute(select(func.count(AgentRun.id)).where(AgentRun.status == 'completed'))
    ).scalar()
    running = (
        await db.execute(select(func.count(AgentRun.id)).where(AgentRun.status == 'running'))
    ).scalar()
    pending_skills = (
        await db.execute(
            select(func.count(Skill.id)).where(
                Skill.approval_status.in_(['draft', 'pending_review'])
            )
        )
    ).scalar()
    reflection_pending = (
        await db.execute(
            select(func.count(ReflectionJob.id)).where(ReflectionJob.status == 'pending')
        )
    ).scalar()
    reflection_completed = (
        await db.execute(
            select(func.count(ReflectionJob.id)).where(ReflectionJob.status == 'completed')
        )
    ).scalar()
    total_memories = (await db.execute(select(func.count(Memory.id)))).scalar()
    evolution_pending = (
        await db.execute(
            select(func.count(EvolutionCandidate.id)).where(
                EvolutionCandidate.approval_status == 'pending'
            )
        )
    ).scalar()

    return {
        'total_runs': total_runs,
        'completed_runs': completed,
        'running_runs': running,
        'pending_skills': pending_skills,
        'reflection_pending': reflection_pending,
        'reflection_completed': reflection_completed,
        'total_memories': total_memories,
        'evolution_pending': evolution_pending,
    }


@router.get('/activity-feed')
async def get_activity_feed(db: DB, user: AdminUser, limit: int = 20):
    """Return a unified activity feed of recent events across the system."""
    events: list[dict] = []

    # Recent runs (join agent name)
    runs_result = await db.execute(
        select(AgentRun, Agent.name.label('agent_name'))
        .outerjoin(Agent, AgentRun.agent_id == Agent.id)
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
    )
    for run, agent_name in runs_result.all():
        ts = run.completed_at or run.started_at or run.created_at
        status_verb = {
            'completed': 'completed',
            'failed': 'failed',
            'running': 'started',
            'queued': 'queued',
        }.get(run.status, run.status)
        events.append({
            'type': 'run',
            'subtype': run.status,
            'id': str(run.id),
            'timestamp': ts.isoformat() if ts else None,
            'message': f'Run {status_verb} — {agent_name or "unknown agent"}',
            'agent_name': agent_name,
            'run_id': str(run.id),
        })

    # Recent memories
    mem_result = await db.execute(
        select(Memory).order_by(Memory.created_at.desc()).limit(limit // 2)
    )
    for mem in mem_result.scalars().all():
        events.append({
            'type': 'memory',
            'id': str(mem.id),
            'timestamp': mem.created_at.isoformat() if mem.created_at else None,
            'message': f'Memory stored — {mem.key[:60]}',
            'scope': mem.scope,
        })

    # Recent reflection jobs completed
    rj_result = await db.execute(
        select(ReflectionJob)
        .where(ReflectionJob.status == 'completed')
        .order_by(ReflectionJob.created_at.desc())
        .limit(5)
    )
    for job in rj_result.scalars().all():
        mem_count = len(job.learned_memories or [])
        skill_count = len(job.drafted_skills or [])
        events.append({
            'type': 'reflection',
            'id': str(job.id),
            'timestamp': job.created_at.isoformat() if job.created_at else None,
            'message': f'Reflection complete — {mem_count} memories, {skill_count} skills',
            'memories_count': mem_count,
            'skills_count': skill_count,
        })

    # Sort all events by timestamp descending
    events.sort(
        key=lambda e: e['timestamp'] or '',
        reverse=True,
    )
    return events[:limit]


@router.get('/reflection-jobs')
async def list_reflection_jobs(db: DB, user: AdminUser, limit: int = 20):
    result = await db.execute(
        select(ReflectionJob).order_by(ReflectionJob.created_at.desc()).limit(limit)
    )
    jobs = result.scalars().all()
    return [
        {
            'id': str(job.id),
            'run_id': str(job.run_id),
            'status': job.status,
            'was_successful': job.was_successful,
            'memories_count': len(job.learned_memories or []),
            'skills_count': len(job.drafted_skills or []),
            'memories': job.learned_memories,
            'skills': job.drafted_skills,
            'error': job.error,
            'created_at': job.created_at.isoformat() if job.created_at else None,
        }
        for job in jobs
    ]


@router.get('/learning-metrics')
async def get_learning_metrics(db: DB, user: AdminUser):
    """Detailed self-learning loop metrics for the Learning dashboard."""
    # Memory timeline: count per day for the last 14 days
    since = datetime.now(timezone.utc) - timedelta(days=14)
    timeline_result = await db.execute(
        select(
            cast(Memory.created_at, Date).label('day'),
            func.count(Memory.id).label('count'),
        )
        .where(Memory.created_at >= since)
        .group_by(cast(Memory.created_at, Date))
        .order_by(cast(Memory.created_at, Date))
    )
    memory_timeline = [
        {'day': str(row.day), 'count': row.count} for row in timeline_result.fetchall()
    ]

    # Recent memories
    recent_memories_result = await db.execute(
        select(Memory).order_by(Memory.created_at.desc()).limit(10)
    )
    recent_memories = [
        {
            'id': str(m.id),
            'scope': m.scope,
            'key': m.key,
            'value': m.value[:200] if m.value else '',
            'tags': m.tags or [],
            'created_at': m.created_at.isoformat() if m.created_at else None,
        }
        for m in recent_memories_result.scalars().all()
    ]

    # Reflection job summary (last 20)
    rj_result = await db.execute(
        select(ReflectionJob).order_by(ReflectionJob.created_at.desc()).limit(20)
    )
    reflection_jobs = [
        {
            'id': str(j.id),
            'run_id': str(j.run_id),
            'status': j.status,
            'was_successful': j.was_successful,
            'memories_count': len(j.learned_memories or []),
            'skills_count': len(j.drafted_skills or []),
            'error': j.error,
            'created_at': j.created_at.isoformat() if j.created_at else None,
            'learned_memories': j.learned_memories or [],
            'drafted_skills': j.drafted_skills or [],
        }
        for j in rj_result.scalars().all()
    ]

    # Evolution candidates (all statuses, last 20) — include diff content for review
    ec_result = await db.execute(
        select(EvolutionCandidate).order_by(EvolutionCandidate.created_at.desc()).limit(20)
    )
    evolution_candidates = [
        {
            'id': str(c.id),
            'skill_id': str(c.skill_id) if c.skill_id else None,
            'type': c.candidate_type,
            'rationale': c.rationale,
            'eval_score': c.eval_score,
            'approval_status': c.approval_status,
            'created_at': c.created_at.isoformat() if c.created_at else None,
            'current_content': c.current_content,
            'proposed_content': c.proposed_content,
        }
        for c in ec_result.scalars().all()
    ]

    return {
        'memory_timeline': memory_timeline,
        'recent_memories': recent_memories,
        'reflection_jobs': reflection_jobs,
        'evolution_candidates': evolution_candidates,
    }


@router.get('/evolution-candidates')
async def list_evolution_candidates(db: DB, user: AdminUser, limit: int = 20):
    result = await db.execute(
        select(EvolutionCandidate)
        .where(EvolutionCandidate.approval_status == 'pending')
        .limit(limit)
    )
    candidates = result.scalars().all()
    return [
        {
            'id': str(candidate.id),
            'skill_id': str(candidate.skill_id) if candidate.skill_id else None,
            'type': candidate.candidate_type,
            'rationale': candidate.rationale,
            'eval_score': candidate.eval_score,
        }
        for candidate in candidates
    ]


@router.post('/evolution-candidates/{candidate_id}/approve')
async def approve_evolution_candidate(candidate_id: UUID, db: DB, user: AdminUser):
    result = await db.execute(
        select(EvolutionCandidate).where(EvolutionCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, 'Candidate not found')

    if candidate.skill_id and candidate.candidate_type == 'skill':
        version_result = await db.execute(
            select(func.max(SkillVersion.version)).where(
                SkillVersion.skill_id == candidate.skill_id
            )
        )
        max_version = version_result.scalar() or 0

        new_version = SkillVersion(
            skill_id=candidate.skill_id,
            version=max_version + 1,
            content=candidate.proposed_content,
            change_summary=f'Evolution candidate approved by {user.email}',
            promoted_by=UUID(user.user_id),
            promoted_at=datetime.now(timezone.utc),
        )
        db.add(new_version)
        await db.flush()

        await db.execute(
            update(Skill)
            .where(Skill.id == candidate.skill_id)
            .values(active_version_id=new_version.id, approval_status='approved')
        )

    await db.execute(
        update(EvolutionCandidate)
        .where(EvolutionCandidate.id == candidate_id)
        .values(
            approval_status='approved',
            approved_by=UUID(user.user_id),
            approved_at=datetime.now(timezone.utc),
        )
    )

    return {'approved': True}


@router.post('/evolution-candidates/{candidate_id}/reject')
async def reject_evolution_candidate(candidate_id: UUID, db: DB, user: AdminUser):
    result = await db.execute(
        select(EvolutionCandidate).where(EvolutionCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, 'Candidate not found')

    await db.execute(
        update(EvolutionCandidate)
        .where(EvolutionCandidate.id == candidate_id)
        .values(approval_status='rejected')
    )

    return {'rejected': True}


@router.get('/services-status')
async def get_services_status(db: DB, user: AdminUser):
    """Ping each infrastructure service and return health + latency."""
    import time

    import httpx
    from sqlalchemy import text

    from conflux.core.config import get_settings

    settings = get_settings()
    results = []

    async def _check(name: str, kind: str, coro):
        t0 = time.monotonic()
        try:
            await coro
            ms = round((time.monotonic() - t0) * 1000)
            return {"name": name, "kind": kind, "status": "ok", "latency_ms": ms}
        except Exception as exc:
            ms = round((time.monotonic() - t0) * 1000)
            return {"name": name, "kind": kind, "status": "error", "latency_ms": ms, "detail": str(exc)[:120]}

    import asyncio

    async def _pg():
        await db.execute(text("SELECT 1"))

    async def _qdrant():
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{settings.qdrant_url}/healthz")
            r.raise_for_status()

    async def _dragonfly():
        from redis.asyncio import Redis
        r = Redis.from_url(settings.dragonfly_url, socket_connect_timeout=3)
        try:
            await r.ping()
        finally:
            await r.aclose()

    async def _searxng():
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{settings.searxng_url}/healthz")
            if r.status_code not in (200, 404):  # 404 = no /healthz but server is up
                r.raise_for_status()

    async def _whisper():
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{settings.whisper_base_url}/health")
            r.raise_for_status()

    async def _telegram():
        from conflux.core.config import get_settings as _gs
        s = _gs()
        if not s.telegram_bot_token:
            raise RuntimeError("Not configured")
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"https://api.telegram.org/bot{s.telegram_bot_token}/getMe")
            r.raise_for_status()

    checks = await asyncio.gather(
        _check("PostgreSQL", "database", _pg()),
        _check("Qdrant", "vector-db", _qdrant()),
        _check("DragonflyDB", "cache", _dragonfly()),
        _check("SearXNG", "search", _searxng()),
        _check("Whisper STT", "ai", _whisper()),
        _check("Telegram Bot", "channel", _telegram()),
    )
    return list(checks)


@router.get('/system-info')
async def get_system_info(user: AdminUser):
    from conflux.providers.registry import get_provider_registry

    registry = get_provider_registry()
    health = await registry.health_check_all()
    return {
        'version': '0.1.0',
        'providers': registry.list_providers(),
        'provider_health': health,
    }
