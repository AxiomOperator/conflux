"""Authentication: API keys + Microsoft Entra ID JWT validation."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

import httpx
import structlog
from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name='X-API-Key', auto_error=False)


class AuthenticatedUser:
    def __init__(
        self,
        user_id: str,
        email: str,
        is_admin: bool = False,
        tenant_id: str | None = None,
        *,
        actual_is_admin: bool | None = None,
        view_as_user: bool = False,
    ):
        self.user_id = user_id
        self.email = email
        self.actual_is_admin = is_admin if actual_is_admin is None else actual_is_admin
        self.view_as_user = view_as_user
        self.is_admin = self.actual_is_admin and not self.view_as_user
        self.tenant_id = tenant_id


def _as_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


async def _is_first_user(db: AsyncSession) -> bool:
    """Return True when the users table is empty (bootstrap scenario)."""
    from conflux.models.user import User
    count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    return count == 0


async def _get_view_as_user_state(db: AsyncSession, user_id: UUID, is_admin: bool) -> bool:
    """Return True if the admin has enabled view-as-user mode."""
    if not is_admin:
        return False

    from conflux.models.user import UserViewAsSetting

    result = await db.execute(
        select(UserViewAsSetting.view_as_user).where(UserViewAsSetting.user_id == user_id)
    )
    return bool(result.scalar_one_or_none())


async def _validate_api_key(key: str) -> AuthenticatedUser | None:
    """Validate an API key against the database."""
    from conflux.core.config import get_settings
    from conflux.core.database import get_db_session
    from conflux.models.user import APIKey, User

    settings = get_settings()
    key_hash = hashlib.sha256(f'{settings.api_key_pepper}{key}'.encode()).hexdigest()

    async with get_db_session() as db:
        result = await db.execute(
            select(APIKey, User)
            .join(User, APIKey.user_id == User.id)
            .where(APIKey.key_hash == key_hash, APIKey.is_active.is_(True), User.is_active.is_(True))
        )
        row = result.first()
        if not row:
            return None

        api_key_rec, user = row
        now = datetime.now(timezone.utc)
        if api_key_rec.expires_at and api_key_rec.expires_at < now:
            return None

        await db.execute(
            update(APIKey)
            .where(APIKey.id == api_key_rec.id)
            .values(last_used_at=now)
        )
        view_as_user = await _get_view_as_user_state(db, user.id, user.is_admin)

        return AuthenticatedUser(
            user_id=str(user.id),
            email=user.email,
            is_admin=user.is_admin,
            view_as_user=view_as_user,
        )


async def _validate_jwt(token: str) -> AuthenticatedUser | None:
    """Validate a JWT issued by Microsoft Entra ID."""
    from conflux.core.config import get_settings
    from conflux.core.database import get_db_session
    from conflux.models.user import User

    settings = get_settings()
    if not settings.azure_ad_tenant_id or not settings.azure_ad_client_id:
        return None

    try:
        jwks_url = (
            f'https://login.microsoftonline.com/{settings.azure_ad_tenant_id}'
            '/discovery/v2.0/keys'
        )
        issuer = f'https://login.microsoftonline.com/{settings.azure_ad_tenant_id}/v2.0'

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(jwks_url)
            resp.raise_for_status()
            jwks = resp.json()

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get('kid')
        key = next((item for item in jwks.get('keys', []) if item.get('kid') == kid), None)
        if not key:
            return None

        payload = jwt.decode(
            token,
            key,
            algorithms=['RS256'],
            audience=settings.azure_ad_client_id,
            issuer=issuer,
            options={'verify_at_hash': False},
        )

        azure_oid = payload.get('oid') or payload.get('sub')
        email = payload.get('preferred_username') or payload.get('email', '')
        tenant_id = payload.get('tid')
        if not azure_oid or not email:
            return None

        display_name = payload.get('name') or email
        async with get_db_session() as db:
            # Look up by azure_oid first, then by email (handles pre-created admin accounts)
            result = await db.execute(select(User).where(User.azure_oid == azure_oid))
            user = result.scalar_one_or_none()
            if user is None:
                result = await db.execute(select(User).where(User.email == email))
                user = result.scalar_one_or_none()

            if user is None:
                first_user = await _is_first_user(db)
                stmt = (
                    insert(User)
                    .values(
                        email=email,
                        display_name=display_name,
                        azure_oid=azure_oid,
                        is_active=True,
                        is_admin=first_user,
                    )
                    .on_conflict_do_update(
                        index_elements=['email'],
                        set_={'display_name': display_name, 'azure_oid': azure_oid},
                    )
                    .returning(User.id, User.is_admin, User.is_active)
                )
                row = (await db.execute(stmt)).first()
                if not row or not row[2]:
                    return None
                # Re-fetch full User object so workspace provisioning can use it
                result = await db.execute(select(User).where(User.id == row[0]))
                user = result.scalar_one_or_none()
                if not user:
                    return None
                user_id = str(user.id)
                is_admin = bool(user.is_admin)
            else:
                if not user.is_active:
                    return None
                # Update azure_oid if it was missing (pre-created account)
                if user.azure_oid != azure_oid:
                    await db.execute(
                        update(User).where(User.id == user.id).values(azure_oid=azure_oid)
                    )
                user_id = str(user.id)
                is_admin = user.is_admin

            # Ensure every user has a personal workspace (idempotent)
            if user.personal_project_id is None:
                try:
                    from conflux.core.workspace import ensure_user_workspace
                    await ensure_user_workspace(db, user)
                    await db.commit()
                except Exception as ws_exc:
                    logger.warning('workspace provisioning failed', error=str(ws_exc))
                    await db.rollback()

            view_as_user = await _get_view_as_user_state(db, _as_uuid(user_id), is_admin)

        return AuthenticatedUser(
            user_id=user_id,
            email=email,
            is_admin=is_admin,
            tenant_id=str(tenant_id) if tenant_id else None,
            view_as_user=view_as_user,
        )
    except (JWTError, httpx.HTTPError, Exception) as exc:
        logger.warning('JWT validation failed', error=str(exc), exc_type=type(exc).__name__)
        return None


async def _validate_internal_secret(secret: str, email: str) -> AuthenticatedUser | None:
    """Validate a request from the Next.js proxy using the shared internal secret."""
    from conflux.core.config import get_settings
    from conflux.core.database import get_db_session
    from conflux.models.user import User

    settings = get_settings()
    if not settings.internal_api_secret or settings.internal_api_secret != secret:
        logger.warning('Internal secret mismatch')
        return None
    if not email:
        return None

    async with get_db_session() as db:
        row = await db.execute(select(User).where(User.email == email))
        user = row.scalar_one_or_none()
        if not user:
            logger.warning('Internal auth: user not found', email=email)
            return None
        # Snapshot values before any commit/rollback expires the object
        user_id_val = str(user.id)
        email_val = user.email
        is_admin_val = user.is_admin
        has_workspace = user.personal_project_id is not None
        # Provision workspace on first internal call too
        if not has_workspace:
            try:
                from conflux.core.workspace import ensure_user_workspace
                await ensure_user_workspace(db, user)
                await db.commit()
            except Exception as ws_exc:
                logger.warning('workspace provisioning failed (internal)', error=str(ws_exc))
                await db.rollback()
        view_as_user = await _get_view_as_user_state(db, _as_uuid(user_id_val), is_admin_val)
        return AuthenticatedUser(
            user_id=user_id_val,
            email=email_val,
            is_admin=is_admin_val,
            view_as_user=view_as_user,
        )


async def get_current_user(
    bearer: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    api_key: str | None = Security(api_key_header),
    x_internal_secret: str | None = Header(None, alias='X-Internal-Secret'),
    x_user_email: str | None = Header(None, alias='X-User-Email'),
) -> AuthenticatedUser:
    """Dependency: get authenticated user from Bearer token, API key, or internal proxy header."""
    user = None

    if x_internal_secret and x_user_email:
        logger.info('Internal proxy auth attempt', email=x_user_email)
        user = await _validate_internal_secret(x_internal_secret, x_user_email)
    elif api_key:
        user = await _validate_api_key(api_key)
    elif bearer:
        logger.info('JWT auth attempt')
        user = await _validate_jwt(bearer.credentials)
    else:
        logger.info('No auth credentials provided')

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or missing credentials',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    return user


async def require_admin(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    """Dependency: require admin role."""
    if not user.actual_is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Admin access required',
        )
    return user


async def get_optional_current_user(
    bearer: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    api_key: str | None = Security(api_key_header),
    x_internal_secret: str | None = Header(None, alias='X-Internal-Secret'),
    x_user_email: str | None = Header(None, alias='X-User-Email'),
) -> AuthenticatedUser | None:
    """Like get_current_user but returns None instead of raising 401."""
    try:
        return await get_current_user(bearer, api_key, x_internal_secret, x_user_email)
    except HTTPException:
        return None


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
AdminUser = Annotated[AuthenticatedUser, Depends(require_admin)]
OptionalUser = Annotated[AuthenticatedUser | None, Depends(get_optional_current_user)]
