"""SSO provider settings and credentials user management routes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, update

from conflux.api.auth import AdminUser, OptionalUser
from conflux.api.deps import DB
from conflux.models.sso_provider import SSOProviderSetting
from conflux.models.user import User

router = APIRouter(prefix="/admin/sso", tags=["sso"])

KNOWN_PROVIDERS: list[str] = ["azure-ad", "github", "google", "oidc", "credentials"]


# ── Schemas ──────────────────────────────────────────────────────────────────

class ProviderStatus(BaseModel):
    provider: str
    enabled: bool
    updated_at: datetime | None = None


class ProviderToggle(BaseModel):
    enabled: bool


class CredentialsUserCreate(BaseModel):
    email: EmailStr
    display_name: str
    password: str
    is_admin: bool = False


class CredentialsUserUpdate(BaseModel):
    display_name: str | None = None
    password: str | None = None
    is_active: bool | None = None
    is_admin: bool | None = None


class CredentialsUserResponse(BaseModel):
    id: UUID
    email: str
    display_name: str
    is_admin: bool
    is_active: bool
    created_at: datetime | None = None


# ── SSO provider settings ─────────────────────────────────────────────────────

@router.get("", response_model=list[ProviderStatus])
async def list_sso_providers(db: DB, _user: AdminUser) -> list[ProviderStatus]:
    """Return enabled status for all known SSO providers."""
    rows = (await db.execute(select(SSOProviderSetting))).scalars().all()
    settings: dict[str, SSOProviderSetting] = {r.provider: r for r in rows}
    return [
        ProviderStatus(
            provider=p,
            enabled=settings[p].enabled if p in settings else False,
            updated_at=settings[p].updated_at if p in settings else None,
        )
        for p in KNOWN_PROVIDERS
    ]


@router.put("/{provider}", response_model=ProviderStatus)
async def update_sso_provider(
    provider: str,
    body: ProviderToggle,
    db: DB,
    _user: AdminUser,
) -> ProviderStatus:
    """Enable or disable an SSO provider."""
    if provider not in KNOWN_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    row = (
        await db.execute(
            select(SSOProviderSetting).where(SSOProviderSetting.provider == provider)
        )
    ).scalar_one_or_none()

    if row is None:
        row = SSOProviderSetting(provider=provider, enabled=body.enabled)
        db.add(row)
    else:
        row.enabled = body.enabled
        row.updated_at = datetime.now(tz=timezone.utc)

    await db.commit()
    await db.refresh(row)
    return ProviderStatus(provider=row.provider, enabled=row.enabled, updated_at=row.updated_at)


# ── Credentials user management ───────────────────────────────────────────────

@router.get("/users", response_model=list[CredentialsUserResponse])
async def list_credentials_users(db: DB, _user: AdminUser) -> list[CredentialsUserResponse]:
    """List users who have a password_hash (credentials-based login)."""
    rows = (
        await db.execute(
            select(User).where(User.password_hash.is_not(None)).order_by(User.created_at)
        )
    ).scalars().all()
    return [
        CredentialsUserResponse(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            is_admin=u.is_admin,
            is_active=u.is_active,
            created_at=u.created_at,
        )
        for u in rows
    ]


@router.post("/users", response_model=CredentialsUserResponse, status_code=201)
async def create_credentials_user(
    body: CredentialsUserCreate,
    db: DB,
    caller: OptionalUser,
) -> CredentialsUserResponse:
    """Create a new user with email/password credentials.

    If no users exist yet (first-run bootstrap), this endpoint is open and the
    created user is automatically made admin regardless of the request body.
    Otherwise, an admin session is required.
    """
    from passlib.context import CryptContext

    user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    is_bootstrap = user_count == 0

    if not is_bootstrap:
        if caller is None or not caller.actual_is_admin:
            from fastapi import HTTPException as _HTTPException
            raise _HTTPException(status_code=403, detail="Admin access required.")

    existing = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="A user with that email already exists.")

    ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    hashed = ctx.hash(body.password)

    # First user always becomes admin
    effective_is_admin = True if is_bootstrap else body.is_admin

    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hashed,
        is_admin=effective_is_admin,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return CredentialsUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.put("/users/{user_id}", response_model=CredentialsUserResponse)
async def update_credentials_user(
    user_id: UUID,
    body: CredentialsUserUpdate,
    db: DB,
    _user: AdminUser,
) -> CredentialsUserResponse:
    """Update a credentials user (name, password, active, admin flags)."""
    from passlib.context import CryptContext

    user = (
        await db.execute(select(User).where(User.id == user_id, User.password_hash.is_not(None)))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Credentials user not found.")

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.password is not None:
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        user.password_hash = ctx.hash(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_admin is not None:
        user.is_admin = body.is_admin

    await db.commit()
    await db.refresh(user)
    return CredentialsUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_credentials_user(
    user_id: UUID,
    db: DB,
    _user: AdminUser,
) -> None:
    """Delete a credentials user."""
    user = (
        await db.execute(select(User).where(User.id == user_id, User.password_hash.is_not(None)))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Credentials user not found.")
    await db.delete(user)
    await db.commit()


# ── Credentials verification (internal — called by Next.js authorize()) ───────

class VerifyCredentialsRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyCredentialsResponse(BaseModel):
    id: str
    email: str
    display_name: str
    is_admin: bool


@router.post("/verify-credentials", response_model=VerifyCredentialsResponse)
async def verify_credentials(body: VerifyCredentialsRequest, db: DB) -> VerifyCredentialsResponse:
    """Verify email+password credentials. Called internally by the Next.js authorize() callback.
    Returns user info on success, 401 on failure. No admin auth required — uses internal secret."""
    from passlib.context import CryptContext

    user = (
        await db.execute(
            select(User).where(User.email == body.email, User.password_hash.is_not(None), User.is_active.is_(True))
        )
    ).scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    if not ctx.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    return VerifyCredentialsResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
    )
