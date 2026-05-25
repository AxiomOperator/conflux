"""Shared FastAPI dependencies."""
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.core.database import get_session_factory


async def get_db():
    factory = get_session_factory()
    async with factory() as session:
        try:
            try:
                from conflux.services import system_settings as system_settings_service

                await system_settings_service.refresh_runtime_settings(session)
            except SQLAlchemyError:
                pass
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


DB = Annotated[AsyncSession, Depends(get_db)]


async def get_effective_setting(db: AsyncSession, key: str) -> str | None:
    """Get a single setting value with any DB override applied."""
    from conflux.services import system_settings as svc
    from conflux.services.settings_catalog import SETTINGS_BY_KEY

    definition = SETTINGS_BY_KEY.get(key)
    fallback = None
    if definition is not None:
        fallback = svc.serialize_setting_value(key, svc.get_default_setting_value(key))

    value = await svc.get_setting(db, key, fallback=fallback)
    return svc.serialize_setting_value(key, value)
