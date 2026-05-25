from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.audit import AuditEvent

router = APIRouter()


class AuditEventOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    event_type: str
    agent_run_id: str | None
    user_id: str | None
    session_id: str | None
    tool_name: str | None
    args_preview: str | None
    result_preview: str | None
    error_message: str | None
    duration_ms: float | None

    model_config = {"from_attributes": True}


class AuditPage(BaseModel):
    items: list[AuditEventOut]
    total: int
    page: int
    page_size: int


@router.get("/audit", response_model=AuditPage)
async def list_audit_events(
    db: DB,
    user: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: str | None = Query(None),
    tool_name: str | None = Query(None),
    agent_run_id: str | None = Query(None),
    user_id: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
) -> AuditPage:
    del user

    stmt = select(AuditEvent)
    count_stmt = select(func.count()).select_from(AuditEvent)

    filters: list[Any] = []
    if event_type:
        filters.append(AuditEvent.event_type == event_type)
    if tool_name:
        filters.append(AuditEvent.tool_name.contains(tool_name))
    if agent_run_id:
        filters.append(AuditEvent.agent_run_id.contains(agent_run_id))
    if user_id:
        filters.append(AuditEvent.user_id.contains(user_id))
    if since:
        if since.tzinfo is not None:
            since = since.astimezone(timezone.utc).replace(tzinfo=None)
        filters.append(AuditEvent.created_at >= since)
    if until:
        if until.tzinfo is not None:
            until = until.astimezone(timezone.utc).replace(tzinfo=None)
        filters.append(AuditEvent.created_at <= until)

    for clause in filters:
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    stmt = stmt.order_by(AuditEvent.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    items = list(result.scalars().all())

    return AuditPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/audit/{event_id}", response_model=AuditEventOut)
async def get_audit_event(event_id: uuid.UUID, db: DB, user: AdminUser) -> AuditEventOut:
    del user

    result = await db.execute(select(AuditEvent).where(AuditEvent.id == event_id))
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Audit event not found")
    return event
