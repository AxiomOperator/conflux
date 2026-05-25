"""Chat session management — persistent conversation threads."""
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from conflux.agents.compression import get_session_compression_state
from conflux.api.auth import CurrentUser
from conflux.api.deps import DB
from conflux.models.agent import AgentRun
from conflux.models.session import Message, Session

router = APIRouter()


def _visible_message_clause():
    return or_(
        Message.run_id.is_(None),
        AgentRun.id.is_(None),
        AgentRun.is_undone.is_(False),
    )


class SessionCreate(BaseModel):
    title: str | None = None
    agent_id: UUID | None = None


class SessionPatch(BaseModel):
    title: str | None = None


class MessagesAppend(BaseModel):
    messages: list[dict]
    run_id: UUID | None = None


def _session_summary(s: Session, last_msg: "Message | None" = None) -> dict:
    return {
        "id": str(s.id),
        "title": s.title,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat() if hasattr(s, "updated_at") and s.updated_at else s.created_at.isoformat(),
        "message_count": 0,
        "last_message": last_msg.content[:120] if last_msg else None,
    }


@router.get("")
async def list_sessions(db: DB, user: CurrentUser, limit: int = 50, offset: int = 0):
    """List chat sessions for current user, newest first."""
    stmt = (
        select(Session)
        .where(Session.user_id == UUID(user.user_id), Session.is_active.is_(True))
        .order_by(Session.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    out = []
    for s in sessions:
        last_msg_result = await db.execute(
            select(Message)
            .outerjoin(AgentRun, AgentRun.id == Message.run_id)
            .where(Message.session_id == s.id, _visible_message_clause())
            .order_by(Message.sequence.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()

        # count messages
        count_result = await db.execute(
            select(func.count())
            .select_from(Message)
            .outerjoin(AgentRun, AgentRun.id == Message.run_id)
            .where(Message.session_id == s.id, _visible_message_clause())
        )
        count = count_result.scalar() or 0

        row = _session_summary(s, last_msg)
        row["message_count"] = count
        row.update(await get_session_compression_state(db, s.id))
        out.append(row)
    return out


@router.post("", status_code=201)
async def create_session(body: SessionCreate, db: DB, user: CurrentUser):
    """Create a new chat session."""
    session = Session(
        id=uuid4(),
        user_id=UUID(user.user_id),
        channel="chat",
        title=body.title or "New Chat",
        is_active=True,
    )
    db.add(session)
    await db.flush()
    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [],
        "latest_run_id": None,
        "is_compressed": False,
        "compressed_at": None,
    }


@router.get("/{session_id}")
async def get_session(session_id: UUID, db: DB, user: CurrentUser):
    """Get a session with all its messages."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if str(session.user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, "Forbidden")

    msgs_result = await db.execute(
        select(Message)
        .outerjoin(AgentRun, AgentRun.id == Message.run_id)
        .where(Message.session_id == session_id, _visible_message_clause())
        .order_by(Message.sequence.asc())
    )
    messages = msgs_result.scalars().all()

    compression_state = await get_session_compression_state(db, session.id)
    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "sequence": m.sequence,
                "run_id": str(m.run_id) if m.run_id else None,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
        **compression_state,
    }


@router.post("/{session_id}/messages", status_code=201)
async def append_messages(
    session_id: UUID, body: MessagesAppend, db: DB, user: CurrentUser
):
    """Append messages to a session after a run completes."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if str(session.user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, "Forbidden")

    # Get current max sequence
    seq_result = await db.execute(
        select(func.max(Message.sequence)).where(Message.session_id == session_id)
    )
    max_seq = seq_result.scalar() or 0

    created = []
    for i, msg in enumerate(body.messages):
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if not content:
            continue
        m = Message(
            id=uuid4(),
            session_id=session_id,
            run_id=body.run_id,
            role=role,
            content=content,
            sequence=max_seq + i + 1,
        )
        db.add(m)
        created.append({"id": str(m.id), "role": role, "sequence": m.sequence})

    await db.flush()
    return {"created": len(created), "messages": created}


@router.patch("/{session_id}")
async def update_session(
    session_id: UUID, body: SessionPatch, db: DB, user: CurrentUser
):
    """Update session title."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if str(session.user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, "Forbidden")

    if body.title is not None:
        session.title = body.title

    return {"id": str(session.id), "title": session.title}


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: UUID, db: DB, user: CurrentUser):
    """Soft-delete a session."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if str(session.user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, "Forbidden")

    session.is_active = False
    return None
