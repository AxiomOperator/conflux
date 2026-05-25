"""Memory routes."""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from conflux.api.auth import CurrentUser
from conflux.api.deps import DB
from conflux.memory.manager import MemoryManager
from conflux.models.memory import Memory

router = APIRouter()
_manager = MemoryManager()


class MemoryWrite(BaseModel):
    scope: str = 'user'
    key: str
    value: str
    tags: list[str] = Field(default_factory=list)


def _resolve_scope_id(scope: str, user: CurrentUser) -> str | None:
    return user.user_id if scope == 'user' else user.tenant_id


@router.get('')
async def list_memory(
    db: DB,
    user: CurrentUser,
    scope: str = Query('user'),
    query: str = Query(''),
    limit: int = Query(20),
):
    scope_id = _resolve_scope_id(scope, user)
    if query:
        results = await _manager.search(
            query=query,
            scope=scope,
            scope_id=scope_id,
            limit=limit,
            user_id=user.user_id,
            tenant_id=user.tenant_id,
        )
        return {'memories': results}

    result = await db.execute(
        select(Memory)
        .where(Memory.scope == scope, Memory.scope_id == scope_id)
        .limit(limit)
    )
    memories = result.scalars().all()
    return {
        'memories': [
            {
                'id': str(memory.id),
                'key': memory.key,
                'value': memory.value,
                'scope': memory.scope,
                'tags': memory.tags,
            }
            for memory in memories
        ]
    }


@router.get('/search')
async def search_memory(
    db: DB,
    user: CurrentUser,
    query: str = Query(''),
    limit: int = Query(50),
):
    """Cross-scope full-text search across all memories the user can access."""
    user_scope_id = user.user_id
    tenant_scope_id = user.tenant_id
    search_query = query.strip()

    stmt = select(Memory).where(
        or_(
            Memory.scope_id == user_scope_id,
            Memory.scope_id == tenant_scope_id,
        )
    )

    if search_query:
        ts_query = func.websearch_to_tsquery('english', search_query)
        stmt = stmt.where(
            Memory.search_vector.op('@@')(ts_query)
        ).order_by(
            func.ts_rank(Memory.search_vector, ts_query).desc(),
            Memory.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(Memory.created_at.desc())

    result = await db.execute(stmt.limit(limit))
    memories = result.scalars().all()

    return {
        'memories': [
            {
                'id': str(m.id),
                'key': m.key,
                'value': m.value,
                'scope': m.scope,
                'tags': m.tags,
                'importance': getattr(m, 'importance', 1),
                'created_at': m.created_at.isoformat() if m.created_at else None,
            }
            for m in memories
        ]
    }


@router.post('', status_code=201)
async def write_memory(body: MemoryWrite, user: CurrentUser):
    scope_id = _resolve_scope_id(body.scope, user)
    memory_id = await _manager.write(
        scope=body.scope,
        scope_id=scope_id,
        key=body.key,
        value=body.value,
        tags=body.tags,
        user_id=user.user_id,
    )
    return {'id': memory_id, 'key': body.key}


@router.delete('/{memory_id}', status_code=204)
async def delete_memory(memory_id: str, db: DB, user: CurrentUser):
    result = await db.execute(select(Memory).where(Memory.id == memory_id))
    memory = result.scalar_one_or_none()
    if not memory:
        return
    if memory.scope == 'user' and memory.scope_id != user.user_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')
    if memory.scope != 'user' and memory.scope_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')
    await db.delete(memory)
