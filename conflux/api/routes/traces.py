from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.traces import RequestTrace

router = APIRouter()


class TraceOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    method: str
    path: str
    query_string: str | None
    status_code: int
    duration_ms: float
    user_email: str | None
    remote_ip: str | None
    user_agent: str | None
    request_body: str | None
    response_body: str | None

    model_config = {"from_attributes": True}


class TracesPage(BaseModel):
    items: list[TraceOut]
    total: int
    page: int
    page_size: int


@router.get("/traces", response_model=TracesPage)
async def list_traces(
    db: DB,
    user: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    method: str | None = Query(None),
    path_contains: str | None = Query(None),
    status_min: int | None = Query(None),
    status_max: int | None = Query(None),
    user_email: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
) -> TracesPage:
    del user

    stmt = select(RequestTrace)
    count_stmt = select(func.count()).select_from(RequestTrace)

    filters: list[Any] = []
    if method:
        filters.append(RequestTrace.method == method.upper())
    if path_contains:
        filters.append(RequestTrace.path.contains(path_contains))
    if status_min is not None:
        filters.append(RequestTrace.status_code >= status_min)
    if status_max is not None:
        filters.append(RequestTrace.status_code <= status_max)
    if user_email:
        filters.append(RequestTrace.user_email.contains(user_email))
    if since:
        # created_at is TIMESTAMP WITHOUT TIME ZONE (UTC-naive) — strip tzinfo
        if since.tzinfo is not None:
            since = since.astimezone(timezone.utc).replace(tzinfo=None)
        filters.append(RequestTrace.created_at >= since)
    if until:
        if until.tzinfo is not None:
            until = until.astimezone(timezone.utc).replace(tzinfo=None)
        filters.append(RequestTrace.created_at <= until)

    for clause in filters:
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    stmt = stmt.order_by(RequestTrace.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    items = list(result.scalars().all())

    return TracesPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/traces/{trace_id}", response_model=TraceOut)
async def get_trace(trace_id: uuid.UUID, db: DB, user: AdminUser) -> TraceOut:
    del user

    result = await db.execute(select(RequestTrace).where(RequestTrace.id == trace_id))
    trace = result.scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace
