"""Provider management routes."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

import structlog

from conflux.api.auth import AdminUser, CurrentUser
from conflux.api.deps import DB
from conflux.models.provider import Provider, ProviderModel

logger = structlog.get_logger(__name__)


async def _refresh_registry() -> None:
    """Reload the provider registry from DB (runs as a background task after commit)."""
    try:
        from conflux.providers.registry import refresh_provider_registry
        await refresh_provider_registry()
        logger.info("provider_registry_refreshed")
    except Exception as exc:
        logger.warning("provider_registry_refresh_failed", error=str(exc))

router = APIRouter()


class ProviderCreate(BaseModel):
    name: str
    provider_type: str
    base_url: str
    api_key: str = ''
    default_model: str = ''


class ProviderUpdate(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    is_enabled: bool | None = None


@router.get('')
async def list_providers(db: DB, user: CurrentUser):
    result = await db.execute(select(Provider))
    providers = result.scalars().all()
    rows = []
    for provider in providers:
        # Grab the first model name to use as default_model display
        model_result = await db.execute(
            select(ProviderModel).where(ProviderModel.provider_id == provider.id).limit(1)
        )
        first_model = model_result.scalar_one_or_none()
        rows.append({
            'id': str(provider.id),
            'name': provider.name,
            'provider_type': provider.provider_type,
            'base_url': provider.base_url,
            'enabled': provider.is_enabled,
            'health_status': provider.health_status,
            'default_model': first_model.model_name if first_model else '',
        })
    return rows


@router.post('', status_code=201)
async def create_provider(body: ProviderCreate, db: DB, user: AdminUser, background_tasks: BackgroundTasks):
    provider = Provider(
        name=body.name,
        provider_type=body.provider_type,
        base_url=body.base_url,
        api_key=body.api_key or None,
    )
    db.add(provider)
    await db.flush()

    if body.default_model:
        db.add(ProviderModel(
            provider_id=provider.id,
            model_name=body.default_model,
            display_name=body.default_model,
        ))
        await db.flush()

    background_tasks.add_task(_refresh_registry)
    return {'id': str(provider.id), 'name': provider.name}


@router.get('/{provider_id}')
async def get_provider(provider_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, 'Provider not found')
    return {
        'id': str(provider.id),
        'name': provider.name,
        'type': provider.provider_type,
        'base_url': provider.base_url,
        'enabled': provider.is_enabled,
    }


@router.patch('/{provider_id}')
async def update_provider(provider_id: UUID, body: ProviderUpdate, db: DB, user: AdminUser, background_tasks: BackgroundTasks):
    try:
        result = await db.execute(select(Provider).where(Provider.id == provider_id))
        provider = result.scalar_one_or_none()
        if not provider:
            raise HTTPException(404, 'Provider not found')
        updates = body.model_dump(exclude_none=True)
        if not updates:
            raise HTTPException(400, 'No fields to update')
        for field, value in updates.items():
            setattr(provider, field, value)
        await db.flush()
        background_tasks.add_task(_refresh_registry)
        return {'id': str(provider.id), 'updated': True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error('update_provider_failed', provider_id=str(provider_id), error=str(exc))
        raise HTTPException(500, f'Failed to update provider: {exc}') from exc


@router.post('/{provider_id}/health-check')
async def health_check_provider(provider_id: UUID, db: DB, user: CurrentUser, background_tasks: BackgroundTasks):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider_row = result.scalar_one_or_none()
    if not provider_row:
        raise HTTPException(404, 'Provider not found')

    from conflux.providers.registry import get_provider_registry

    # Refresh the registry first so health check reflects current DB state
    background_tasks.add_task(_refresh_registry)
    registry = get_provider_registry()
    try:
        provider = registry.get(provider_row.name)
        ok = await provider.health_check()
    except KeyError:
        ok = False

    await db.execute(
        update(Provider)
        .where(Provider.id == provider_id)
        .values(
            health_status='healthy' if ok else 'unhealthy',
            last_health_check_at=datetime.now(timezone.utc),
        )
    )
    return {'healthy': ok}


@router.delete('/{provider_id}', status_code=204)
async def delete_provider(provider_id: UUID, db: DB, user: AdminUser, background_tasks: BackgroundTasks):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, 'Provider not found')
    models_result = await db.execute(
        select(ProviderModel).where(ProviderModel.provider_id == provider_id)
    )
    for model in models_result.scalars().all():
        await db.delete(model)
    await db.delete(provider)
    background_tasks.add_task(_refresh_registry)


@router.get('/{provider_id}/models')
async def list_provider_models(provider_id: UUID, db: DB, user: CurrentUser):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider_row = result.scalar_one_or_none()
    if not provider_row:
        raise HTTPException(404, 'Provider not found')

    from conflux.providers.registry import get_provider_registry

    registry = get_provider_registry()
    try:
        provider = registry.get(provider_row.name)
        models = await provider.list_models()
        return {'models': models}
    except Exception as exc:
        raise HTTPException(500, f'Failed to list models: {exc}') from exc


class ProviderModelCreate(BaseModel):
    model_name: str
    display_name: str | None = None
    context_length: int | None = None
    input_cost_per_1k: float = 0.0
    output_cost_per_1k: float = 0.0


@router.post('/{provider_id}/models', status_code=201)
async def add_provider_model(
    provider_id: UUID,
    body: ProviderModelCreate,
    db: DB,
    user: AdminUser,
    background_tasks: BackgroundTasks,
):
    """Manually register a model under a provider."""
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, 'Provider not found')

    model = ProviderModel(
        provider_id=provider_id,
        model_name=body.model_name,
        display_name=body.display_name,
        context_length=body.context_length,
        input_cost_per_1k=body.input_cost_per_1k,
        output_cost_per_1k=body.output_cost_per_1k,
    )
    db.add(model)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"Model '{body.model_name}' is already registered for this provider.")
    background_tasks.add_task(_refresh_registry)
    return {
        'id': str(model.id),
        'model_name': model.model_name,
        'display_name': model.display_name,
        'provider_id': str(provider_id),
    }


@router.delete('/{provider_id}/models/{model_id}', status_code=204)
async def remove_provider_model(
    provider_id: UUID,
    model_id: UUID,
    db: DB,
    user: AdminUser,
    background_tasks: BackgroundTasks,
):
    """Remove a manually registered model from a provider."""
    result = await db.execute(
        select(ProviderModel).where(
            ProviderModel.id == model_id,
            ProviderModel.provider_id == provider_id,
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, 'Model not found')
    await db.delete(model)
    background_tasks.add_task(_refresh_registry)


@router.get('/{provider_id}/registered-models')
async def list_registered_models(provider_id: UUID, db: DB, user: CurrentUser):
    """List models that have been manually registered in the database for this provider."""
    try:
        provider_row = (await db.execute(select(Provider).where(Provider.id == provider_id))).scalar_one_or_none()
        if not provider_row:
            raise HTTPException(404, 'Provider not found')
        result = await db.execute(
            select(ProviderModel)
            .where(ProviderModel.provider_id == provider_id)
            .order_by(ProviderModel.model_name)
        )
        models = result.scalars().all()
        return {
            'models': [
                {
                    'id': str(m.id),
                    'model_name': m.model_name,
                    'display_name': m.display_name,
                    'context_length': m.context_length,
                    'input_cost_per_1k': m.input_cost_per_1k,
                    'output_cost_per_1k': m.output_cost_per_1k,
                    'created_at': m.created_at.isoformat() if m.created_at else None,
                }
                for m in models
            ]
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_registered_models_error", provider_id=str(provider_id), error=str(exc))
        raise HTTPException(500, f"Failed to list registered models: {exc}") from exc
