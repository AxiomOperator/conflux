from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.trajectory import Trajectory

router = APIRouter(prefix='/admin/trajectories', tags=['trajectories'])


class TrajectoryResponse(BaseModel):
    id: UUID
    run_id: UUID | None
    agent_id: UUID | None
    agent_name: str | None
    system_prompt: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    message_count: int
    status: str
    quality_score: float | None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime | None
    input_tokens: int
    output_tokens: int


class TrajectoryApprove(BaseModel):
    quality_score: float | None = None
    tags: list[str] = Field(default_factory=list)


class TrajectoryListResponse(BaseModel):
    items: list[TrajectoryResponse]
    page: int
    limit: int
    total: int


def _to_response(trajectory: Trajectory) -> TrajectoryResponse:
    return TrajectoryResponse(
        id=trajectory.id,
        run_id=trajectory.run_id,
        agent_id=trajectory.agent_id,
        agent_name=trajectory.agent_name,
        system_prompt=trajectory.system_prompt,
        messages=trajectory.messages or [],
        message_count=trajectory.message_count,
        status=trajectory.status,
        quality_score=trajectory.quality_score,
        tags=trajectory.tags or [],
        created_at=trajectory.created_at,
        input_tokens=trajectory.input_tokens,
        output_tokens=trajectory.output_tokens,
    )


def _openai_messages(trajectory: Trajectory) -> list[dict[str, str]]:
    exported: list[dict[str, str]] = []
    if trajectory.system_prompt:
        exported.append({'role': 'system', 'content': trajectory.system_prompt})

    for message in trajectory.messages or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get('role', '')).strip().lower()
        if role not in {'system', 'user', 'assistant'}:
            continue
        content = message.get('content')
        if not content:
            continue
        exported.append({'role': role, 'content': str(content)})

    conversation_messages = [message for message in exported if message['role'] != 'system']
    return exported if len(conversation_messages) >= 2 else []


@router.get('', response_model=TrajectoryListResponse)
async def list_trajectories(
    db: DB,
    user: AdminUser,
    status: str | None = Query(default=None),
    agent_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    filters = []
    if status:
        filters.append(Trajectory.status == status)
    if agent_id:
        filters.append(Trajectory.agent_id == agent_id)

    total = (
        await db.execute(select(func.count(Trajectory.id)).where(*filters))
    ).scalar_one()
    offset = (page - 1) * limit
    result = await db.execute(
        select(Trajectory)
        .where(*filters)
        .order_by(Trajectory.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    trajectories = result.scalars().all()
    return TrajectoryListResponse(
        items=[_to_response(trajectory) for trajectory in trajectories],
        page=page,
        limit=limit,
        total=total,
    )


@router.get('/export')
async def export_trajectories(
    db: DB,
    user: AdminUser,
    format: str = Query(default='openai'),
):
    if format != 'openai':
        raise HTTPException(status_code=400, detail='Unsupported export format')

    result = await db.execute(
        select(Trajectory)
        .where(Trajectory.status == 'approved')
        .order_by(Trajectory.created_at.asc())
    )
    trajectories = result.scalars().all()

    async def stream_rows():
        for trajectory in trajectories:
            messages = _openai_messages(trajectory)
            if not messages:
                continue
            yield json.dumps({'messages': messages}) + '\n'

    return StreamingResponse(
        stream_rows(),
        media_type='application/x-ndjson',
        headers={'Content-Disposition': 'attachment; filename="trajectories.jsonl"'},
    )


@router.put('/{trajectory_id}/approve', response_model=TrajectoryResponse)
async def approve_trajectory(
    trajectory_id: UUID,
    body: TrajectoryApprove,
    db: DB,
    user: AdminUser,
):
    result = await db.execute(select(Trajectory).where(Trajectory.id == trajectory_id))
    trajectory = result.scalar_one_or_none()
    if not trajectory:
        raise HTTPException(status_code=404, detail='Trajectory not found')

    trajectory.status = 'approved'
    trajectory.quality_score = body.quality_score
    trajectory.tags = body.tags
    await db.flush()
    return _to_response(trajectory)


@router.put('/{trajectory_id}/reject', response_model=TrajectoryResponse)
async def reject_trajectory(trajectory_id: UUID, db: DB, user: AdminUser):
    result = await db.execute(select(Trajectory).where(Trajectory.id == trajectory_id))
    trajectory = result.scalar_one_or_none()
    if not trajectory:
        raise HTTPException(status_code=404, detail='Trajectory not found')

    trajectory.status = 'rejected'
    await db.flush()
    return _to_response(trajectory)


@router.delete('/{trajectory_id}', status_code=204)
async def delete_trajectory(trajectory_id: UUID, db: DB, user: AdminUser):
    result = await db.execute(select(Trajectory).where(Trajectory.id == trajectory_id))
    trajectory = result.scalar_one_or_none()
    if not trajectory:
        raise HTTPException(status_code=404, detail='Trajectory not found')

    await db.delete(trajectory)
    await db.flush()
    return Response(status_code=204)
