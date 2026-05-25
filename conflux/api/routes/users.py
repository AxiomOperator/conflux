"""User management routes."""
import hashlib
import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.agent import Agent
from conflux.models.user import APIKey, User

router = APIRouter()


class UserUpdate(BaseModel):
    display_name: str | None = None


class APIKeyCreate(BaseModel):
    name: str
    expires_days: int | None = None


class UserPersonaUpdate(BaseModel):
    agents_md: str | None = None
    soul_md: str | None = None
    user_md: str | None = None
    identity_md: str | None = None
    tools_md: str | None = None
    heartbeat_md: str | None = None
    boot_md: str | None = None


def _persona_dict(p: "UserPersonaFiles") -> dict:
    return {
        'agents_md': p.agents_md,
        'soul_md': p.soul_md,
        'user_md': p.user_md,
        'identity_md': p.identity_md,
        'tools_md': p.tools_md,
        'heartbeat_md': p.heartbeat_md,
        'boot_md': p.boot_md,
    }


@router.get('/me')
async def get_me(db: DB, user: CurrentUser):
    result = await db.execute(select(User).where(User.id == UUID(user.user_id)))
    current = result.scalar_one_or_none()
    if not current:
        raise HTTPException(404, 'User not found')

    workspace: dict | None = None
    if current.personal_project_id:
        # Find personal orchestrator
        orch_result = await db.execute(
            select(Agent)
            .where(
                Agent.project_id == current.personal_project_id,
                Agent.agent_type == 'orchestrator',
                Agent.is_enabled.is_(True),
            )
            .limit(1)
        )
        orch = orch_result.scalar_one_or_none()
        workspace = {
            'project_id': str(current.personal_project_id),
            'tenant_id': str(current.personal_tenant_id) if current.personal_tenant_id else None,
            'orchestrator_id': str(orch.id) if orch else None,
            'orchestrator_name': orch.name if orch else None,
        }

    return {
        'id': str(current.id),
        'email': current.email,
        'display_name': current.display_name,
        'is_admin': current.is_admin,
        'view_as_user': user.view_as_user,
        'workspace': workspace,
    }


@router.patch('/me')
async def update_me(body: UserUpdate, db: DB, user: CurrentUser):
    result = await db.execute(select(User).where(User.id == UUID(user.user_id)))
    current = result.scalar_one_or_none()
    if not current:
        raise HTTPException(404, 'User not found')
    if body.display_name:
        current.display_name = body.display_name
    return {'updated': True}


@router.get('/me/persona')
async def get_my_persona(db: DB, user: CurrentUser):
    from conflux.models.user import UserPersonaFiles

    result = await db.execute(
        select(UserPersonaFiles).where(UserPersonaFiles.user_id == UUID(user.user_id))
    )
    persona = result.scalar_one_or_none()
    if not persona:
        return {
            'agents_md': None,
            'soul_md': None,
            'user_md': None,
            'identity_md': None,
            'tools_md': None,
            'heartbeat_md': None,
            'boot_md': None,
        }
    return _persona_dict(persona)


@router.patch('/me/persona')
async def update_my_persona(body: UserPersonaUpdate, db: DB, user: CurrentUser):
    import uuid as _uuid

    from conflux.models.user import UserPersonaFiles

    result = await db.execute(
        select(UserPersonaFiles).where(UserPersonaFiles.user_id == UUID(user.user_id))
    )
    persona = result.scalar_one_or_none()
    if not persona:
        persona = UserPersonaFiles(
            id=_uuid.uuid4(),
            user_id=UUID(user.user_id),
        )
        db.add(persona)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(persona, field, value)

    await db.flush()
    return _persona_dict(persona)


@router.get('/me/api-keys')
async def list_my_api_keys(db: DB, user: CurrentUser):
    """List API keys for the current user."""
    result = await db.execute(
        select(APIKey).where(APIKey.user_id == UUID(user.user_id), APIKey.is_active.is_(True))
    )
    keys = result.scalars().all()
    return [
        {
            'id': str(key.id),
            'name': key.name,
            'last_used_at': key.last_used_at.isoformat() if key.last_used_at else None,
            'expires_at': key.expires_at.isoformat() if key.expires_at else None,
            'created_at': key.created_at.isoformat() if key.created_at else None,
        }
        for key in keys
    ]


@router.post('/me/api-keys', status_code=201)
async def create_my_api_key(body: APIKeyCreate, db: DB, user: CurrentUser):
    """Create a new API key for the current user."""
    from datetime import datetime, timedelta, timezone

    from conflux.core.config import get_settings

    settings = get_settings()
    raw_key = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(f'{settings.api_key_pepper}{raw_key}'.encode()).hexdigest()

    expires_at = None
    if body.expires_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_days)

    api_key = APIKey(
        user_id=UUID(user.user_id),
        key_hash=key_hash,
        name=body.name,
        expires_at=expires_at,
    )
    db.add(api_key)
    await db.flush()

    return {
        'id': str(api_key.id),
        'name': api_key.name,
        'key': raw_key,
        'note': 'Store this key securely — it will not be shown again',
    }


@router.delete('/me/api-keys/{key_id}', status_code=204)
async def revoke_my_api_key(key_id: UUID, db: DB, user: CurrentUser):
    """Revoke an API key belonging to the current user."""
    result = await db.execute(
        select(APIKey).where(APIKey.id == key_id, APIKey.user_id == UUID(user.user_id))
    )
    key = result.scalar_one_or_none()
    if key:
        key.is_active = False


@router.get('')
async def list_users(db: DB, user: AdminUser, limit: int = 50):
    result = await db.execute(select(User).limit(limit))
    users = result.scalars().all()
    return [
        {
            'id': str(entry.id),
            'email': entry.email,
            'display_name': entry.display_name,
            'is_admin': entry.is_admin,
            'is_active': entry.is_active,
        }
        for entry in users
    ]


class AdminUserUpdate(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None


@router.patch('/{user_id}')
async def update_user(user_id: UUID, body: AdminUserUpdate, db: DB, user: AdminUser):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, 'User not found')
    if body.is_admin is not None:
        target.is_admin = body.is_admin
    if body.is_active is not None:
        target.is_active = body.is_active
    return {'id': str(target.id), 'updated': True}


@router.get('/{user_id}/api-keys')
async def list_api_keys(user_id: UUID, db: DB, user: CurrentUser):
    if str(user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')
    result = await db.execute(
        select(APIKey).where(APIKey.user_id == user_id, APIKey.is_active.is_(True))
    )
    keys = result.scalars().all()
    return [
        {
            'id': str(key.id),
            'name': key.name,
            'last_used_at': key.last_used_at.isoformat() if key.last_used_at else None,
            'expires_at': key.expires_at.isoformat() if key.expires_at else None,
        }
        for key in keys
    ]


@router.post('/{user_id}/api-keys', status_code=201)
async def create_api_key(user_id: UUID, body: APIKeyCreate, db: DB, user: CurrentUser):
    if str(user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')

    from datetime import datetime, timedelta, timezone

    from conflux.core.config import get_settings

    settings = get_settings()
    raw_key = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(f'{settings.api_key_pepper}{raw_key}'.encode()).hexdigest()

    expires_at = None
    if body.expires_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_days)

    api_key = APIKey(
        user_id=user_id,
        key_hash=key_hash,
        name=body.name,
        expires_at=expires_at,
    )
    db.add(api_key)
    await db.flush()

    return {
        'id': str(api_key.id),
        'name': api_key.name,
        'key': raw_key,
        'note': 'Store this key securely — it will not be shown again',
    }


@router.delete('/{user_id}/api-keys/{key_id}', status_code=204)
async def revoke_api_key(user_id: UUID, key_id: UUID, db: DB, user: CurrentUser):
    if str(user_id) != user.user_id and not user.is_admin:
        raise HTTPException(403, 'Forbidden')
    result = await db.execute(
        select(APIKey).where(APIKey.id == key_id, APIKey.user_id == user_id)
    )
    key = result.scalar_one_or_none()
    if key:
        key.is_active = False
