from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.services import system_settings as svc
from conflux.services.settings_catalog import SETTINGS_BY_KEY, SETTINGS_CATALOG, SettingDef

router = APIRouter()


class SettingOut(BaseModel):
    key: str
    category: str
    label: str
    description: str
    sensitive: bool
    setting_type: str
    env_value: str | None
    db_value: str | None
    effective_value: str | None
    has_db_override: bool


class SettingUpdate(BaseModel):
    value: str | None


def _mask_value(definition: SettingDef, value: str | None) -> str | None:
    if definition.sensitive and value not in (None, ""):
        return "***"
    return value


def _build_setting_out(definition: SettingDef, db_values: dict[str, str | None]) -> SettingOut:
    env_value = svc.serialize_setting_value(
        definition.key,
        svc.get_default_setting_value(definition.key),
    )
    db_value_raw = db_values.get(definition.key)
    db_value = None if db_value_raw is None else svc.serialize_setting_value(
        definition.key,
        svc.coerce_setting_value(definition.key, db_value_raw),
    )
    effective_value = db_value if definition.key in db_values else env_value

    return SettingOut(
        key=definition.key,
        category=definition.category,
        label=definition.label,
        description=definition.description,
        sensitive=definition.sensitive,
        setting_type=definition.setting_type,
        env_value=_mask_value(definition, env_value),
        db_value=_mask_value(definition, db_value),
        effective_value=_mask_value(definition, effective_value),
        has_db_override=definition.key in db_values,
    )


def _get_setting_def(key: str) -> SettingDef:
    definition = SETTINGS_BY_KEY.get(key)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"Unknown setting: {key}")
    return definition


@router.get("/settings", response_model=list[SettingOut])
async def list_settings(db: DB, user: AdminUser) -> list[SettingOut]:
    del user
    db_values = await svc.get_all_settings(db)
    return [_build_setting_out(definition, db_values) for definition in SETTINGS_CATALOG]


@router.put("/settings/{key}", response_model=SettingOut)
async def update_setting(key: str, body: SettingUpdate, db: DB, user: AdminUser) -> SettingOut:
    definition = _get_setting_def(key)

    if body.value is None:
        await svc.delete_setting(db, key)
    else:
        try:
            normalized = svc.normalize_setting_input(key, body.value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        await svc.set_setting(db, key, normalized, updated_by=user.email or user.user_id)

    db_values = await svc.get_all_settings(db)
    return _build_setting_out(definition, db_values)


@router.delete("/settings/{key}")
async def reset_setting(key: str, db: DB, user: AdminUser) -> dict[str, bool | str]:
    del user
    _get_setting_def(key)
    await svc.delete_setting(db, key)
    return {"key": key, "reset": True}
