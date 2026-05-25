from __future__ import annotations

import asyncio
import copy
import time
from typing import Any

import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from conflux.core.config import get_settings
from conflux.core.database import get_db_session
from conflux.models.system_settings import SystemSetting
from conflux.services.settings_catalog import SETTINGS_BY_KEY, SETTINGS_CATALOG

LOGGER = structlog.get_logger(__name__)

_cache: dict[str, str | None] = {}
_cache_ts: float = 0.0
_CACHE_TTL = 60.0
_cache_lock = asyncio.Lock()
_env_defaults: dict[str, Any] = {
    setting.key: copy.deepcopy(getattr(get_settings(), setting.env_attr))
    for setting in SETTINGS_CATALOG
}
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


def get_default_setting_value(key: str) -> Any:
    return copy.deepcopy(_env_defaults.get(key))


def coerce_setting_value(key: str, value: Any) -> Any:
    if value is None:
        return None

    definition = SETTINGS_BY_KEY.get(key)
    if definition is None:
        return value

    if definition.setting_type == "bool":
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().lower()
        if normalized in _TRUE_VALUES:
            return True
        if normalized in _FALSE_VALUES:
            return False
        raise ValueError(f"Invalid boolean value for {key}: {value}")

    if definition.setting_type == "int":
        if isinstance(value, int):
            return value
        return int(str(value).strip())

    if definition.setting_type == "list":
        if isinstance(value, list):
            return ",".join(str(item).strip() for item in value if str(item).strip())
        # Normalize comma-separated string: strip whitespace around each item
        return ",".join(item.strip() for item in str(value).split(",") if item.strip())

    return str(value)


def serialize_setting_value(key: str, value: Any) -> str | None:
    if value is None:
        return None

    definition = SETTINGS_BY_KEY.get(key)
    if definition and definition.setting_type == "bool":
        return "true" if bool(value) else "false"

    return str(value)


def normalize_setting_input(key: str, value: str | None) -> str | None:
    if value is None:
        return None

    coerced = coerce_setting_value(key, value)
    return serialize_setting_value(key, coerced)


def _apply_runtime_overrides() -> None:
    settings = get_settings()
    for definition in SETTINGS_CATALOG:
        raw_value = _cache.get(definition.key)
        effective = get_default_setting_value(definition.key)
        if raw_value is not None:
            effective = coerce_setting_value(definition.key, raw_value)
        setattr(settings, definition.env_attr, effective)


async def _load_cache(db: AsyncSession) -> None:
    global _cache, _cache_ts

    result = await db.execute(select(SystemSetting))
    _cache = {row.key: row.value for row in result.scalars().all()}
    _cache_ts = time.monotonic()
    _apply_runtime_overrides()


async def refresh_runtime_settings(db: AsyncSession, *, force: bool = False) -> None:
    global _cache_ts

    if not force and time.monotonic() - _cache_ts <= _CACHE_TTL:
        _apply_runtime_overrides()
        return

    async with _cache_lock:
        if not force and time.monotonic() - _cache_ts <= _CACHE_TTL:
            _apply_runtime_overrides()
            return
        await _load_cache(db)


async def bootstrap_runtime_settings() -> None:
    try:
        async with get_db_session() as db:
            await refresh_runtime_settings(db, force=True)
    except SQLAlchemyError as exc:
        LOGGER.warning("system_settings_bootstrap_failed", error=str(exc))


async def get_setting(db: AsyncSession, key: str, fallback: Any = None) -> Any:
    await refresh_runtime_settings(db)
    if key in _cache and _cache[key] is not None:
        return coerce_setting_value(key, _cache[key])
    return fallback


async def set_setting(db: AsyncSession, key: str, value: str | None, updated_by: str) -> None:
    global _cache, _cache_ts

    if value is None:
        await delete_setting(db, key)
        return

    normalized = normalize_setting_input(key, value)
    stmt = insert(SystemSetting).values(key=key, value=normalized, updated_by=updated_by)
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value": normalized, "updated_by": updated_by, "updated_at": func.now()},
    )
    await db.execute(stmt)
    await db.commit()
    _cache[key] = normalized
    _cache_ts = time.monotonic()
    _apply_runtime_overrides()


async def delete_setting(db: AsyncSession, key: str) -> None:
    global _cache, _cache_ts

    await db.execute(delete(SystemSetting).where(SystemSetting.key == key))
    await db.commit()
    _cache.pop(key, None)
    _cache_ts = time.monotonic()
    _apply_runtime_overrides()


async def get_all_settings(db: AsyncSession) -> dict[str, str | None]:
    await refresh_runtime_settings(db)
    return dict(_cache)
