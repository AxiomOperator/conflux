"""Backup and restore routes for configuration data."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import DateTime, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.models.agent import Agent
from conflux.models.mcp import McpServer
from conflux.models.provider import Provider, ProviderModel
from conflux.models.schedule import ScheduledTask
from conflux.models.skill import Skill, SkillFile, SkillVersion
from conflux.models.sso_provider import SSOProviderSetting
from conflux.models.system_settings import SystemSetting
from conflux.models.tenant import Project, Tenant
from conflux.models.tool import ToolConfig
from conflux.models.user import APIKey, User

logger = structlog.get_logger(__name__)
router = APIRouter()


@dataclass(frozen=True)
class TableConfig:
    section: str
    table_name: str
    model: Any
    conflict_columns: tuple[str, ...]
    backup_exclude: tuple[str, ...] = ()
    restore_exclude: tuple[str, ...] = ()
    do_update: bool = True
    user_fk_columns: tuple[str, ...] = ()


SYSTEM_SETTINGS_CONFIG = TableConfig(
    section='system_settings',
    table_name='system_settings',
    model=SystemSetting,
    conflict_columns=('key',),
)
PROVIDERS_CONFIG = TableConfig(
    section='providers',
    table_name='providers',
    model=Provider,
    conflict_columns=('id',),
)
PROVIDER_MODELS_CONFIG = TableConfig(
    section='provider_models',
    table_name='provider_models',
    model=ProviderModel,
    conflict_columns=('id',),
)
AGENTS_CONFIG = TableConfig(
    section='agents',
    table_name='agents',
    model=Agent,
    conflict_columns=('id',),
    user_fk_columns=('created_by',),
)
SKILLS_CONFIG = TableConfig(
    section='skills',
    table_name='skills',
    model=Skill,
    conflict_columns=('id',),
    restore_exclude=('active_version_id',),
    user_fk_columns=('owner_user_id',),
)
SKILL_VERSIONS_CONFIG = TableConfig(
    section='skill_versions',
    table_name='skill_versions',
    model=SkillVersion,
    conflict_columns=('id',),
    user_fk_columns=('promoted_by',),
)
SKILL_FILES_CONFIG = TableConfig(
    section='skill_files',
    table_name='skill_files',
    model=SkillFile,
    conflict_columns=('id',),
)
TOOL_CONFIGS_CONFIG = TableConfig(
    section='tool_configs',
    table_name='tool_configs',
    model=ToolConfig,
    conflict_columns=('id',),
)
MCP_SERVERS_CONFIG = TableConfig(
    section='mcp_servers',
    table_name='mcp_servers',
    model=McpServer,
    conflict_columns=('id',),
    user_fk_columns=('created_by',),
)
SSO_PROVIDER_SETTINGS_CONFIG = TableConfig(
    section='sso_provider_settings',
    table_name='sso_provider_settings',
    model=SSOProviderSetting,
    conflict_columns=('id',),
)
USERS_CONFIG = TableConfig(
    section='users',
    table_name='users',
    model=User,
    conflict_columns=('email',),
    backup_exclude=('password_hash', 'hashed_password'),
    restore_exclude=('password_hash', 'hashed_password', 'personal_project_id'),
    do_update=False,
)
API_KEYS_CONFIG = TableConfig(
    section='api_keys',
    table_name='api_keys',
    model=APIKey,
    conflict_columns=('id',),
    user_fk_columns=('user_id',),
)
SCHEDULED_TASKS_CONFIG = TableConfig(
    section='scheduled_tasks',
    table_name='scheduled_tasks',
    model=ScheduledTask,
    conflict_columns=('id',),
    user_fk_columns=('created_by',),
)
TENANTS_CONFIG = TableConfig(
    section='tenants',
    table_name='tenants',
    model=Tenant,
    conflict_columns=('id',),
)
PROJECTS_CONFIG = TableConfig(
    section='projects',
    table_name='projects',
    model=Project,
    conflict_columns=('id',),
    user_fk_columns=('owner_user_id',),
)

BACKUP_TABLES = (
    SYSTEM_SETTINGS_CONFIG,
    PROVIDERS_CONFIG,
    PROVIDER_MODELS_CONFIG,
    AGENTS_CONFIG,
    SKILLS_CONFIG,
    SKILL_VERSIONS_CONFIG,
    SKILL_FILES_CONFIG,
    TOOL_CONFIGS_CONFIG,
    MCP_SERVERS_CONFIG,
    SSO_PROVIDER_SETTINGS_CONFIG,
    USERS_CONFIG,
    API_KEYS_CONFIG,
    SCHEDULED_TASKS_CONFIG,
    TENANTS_CONFIG,
    PROJECTS_CONFIG,
)
RESTORE_ORDER = (
    SYSTEM_SETTINGS_CONFIG,
    TENANTS_CONFIG,
    USERS_CONFIG,
    PROJECTS_CONFIG,
    PROVIDERS_CONFIG,
    PROVIDER_MODELS_CONFIG,
    AGENTS_CONFIG,
    SKILLS_CONFIG,
    SKILL_VERSIONS_CONFIG,
    SKILL_FILES_CONFIG,
    TOOL_CONFIGS_CONFIG,
    MCP_SERVERS_CONFIG,
    SSO_PROVIDER_SETTINGS_CONFIG,
    API_KEYS_CONFIG,
    SCHEDULED_TASKS_CONFIG,
)


def json_default(obj: Any):
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f'Not serializable: {type(obj)}')


async def _refresh_provider_registry_task() -> None:
    try:
        from conflux.providers.registry import refresh_provider_registry

        await refresh_provider_registry()
        logger.info('provider_registry_refreshed_after_backup_restore')
    except Exception as exc:
        logger.warning('provider_registry_refresh_failed_after_backup_restore', error=str(exc))


def _column_map(config: TableConfig) -> dict[str, Any]:
    return {column.name: column for column in config.model.__table__.columns}


def _section_rows(data: dict[str, Any], section: str) -> list[dict[str, Any]]:
    rows = data.get(section, [])
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail=f"Backup section '{section}' must be a list")
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail=f"Backup section '{section}' must contain objects")
        normalized_rows.append(row)
    return normalized_rows


def _ordered_columns(config: TableConfig, exclude: tuple[str, ...] | None = None) -> list[str]:
    excluded = set(exclude or ())
    return [
        column.name
        for column in config.model.__table__.columns
        if column.name not in excluded
    ]


def _build_upsert_sql(config: TableConfig, columns: list[str]):
    column_map = _column_map(config)
    insert_columns = ', '.join(columns)
    values_sql = ', '.join(
        f'CAST(:{column} AS jsonb)' if isinstance(column_map[column].type, JSONB) else f':{column}'
        for column in columns
    )
    conflict_sql = ', '.join(config.conflict_columns)
    if config.do_update:
        update_columns = [column for column in columns if column not in config.conflict_columns]
        if update_columns:
            action_sql = 'DO UPDATE SET ' + ', '.join(
                f'{column} = EXCLUDED.{column}' for column in update_columns
            )
        else:
            action_sql = 'DO NOTHING'
    else:
        action_sql = 'DO NOTHING'
    return text(
        f'INSERT INTO {config.table_name} ({insert_columns}) '
        f'VALUES ({values_sql}) '
        f'ON CONFLICT ({conflict_sql}) {action_sql}'
    )


def _parse_datetime(value: Any) -> datetime | Any:
    if not isinstance(value, str):
        return value
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _coerce_bind_value(column: Any, value: Any) -> Any:
    if isinstance(column.type, PGUUID):
        if value in (None, ''):
            return None
        return value if isinstance(value, UUID) else UUID(str(value))
    if isinstance(column.type, DateTime):
        if value in (None, ''):
            return None
        return _parse_datetime(value)
    if isinstance(column.type, JSONB):
        return None if value is None else json.dumps(value)
    return value


def _prepare_row(config: TableConfig, row: dict[str, Any], user_id_map: dict[str, UUID]) -> dict[str, Any]:
    column_map = _column_map(config)
    prepared: dict[str, Any] = {}
    for column_name in _ordered_columns(config, config.restore_exclude):
        value = row.get(column_name)
        if column_name in config.user_fk_columns and value is not None:
            value = user_id_map.get(str(value), value)
        prepared[column_name] = _coerce_bind_value(column_map[column_name], value)
    return prepared


def _result_count(result: Any) -> int:
    rowcount = getattr(result, 'rowcount', 0) or 0
    return rowcount if rowcount > 0 else 0


async def _backup_section(db: DB, config: TableConfig) -> list[dict[str, Any]]:
    order_sql = ', '.join(config.conflict_columns)
    result = await db.execute(text(f'SELECT * FROM {config.table_name} ORDER BY {order_sql}'))
    rows: list[dict[str, Any]] = []
    for row in result:
        item = dict(row._mapping)
        for column_name in config.backup_exclude:
            item.pop(column_name, None)
        rows.append(item)
    return rows


async def _restore_generic_section(
    db: DB,
    config: TableConfig,
    rows: list[dict[str, Any]],
    user_id_map: dict[str, UUID],
) -> int:
    if not rows:
        return 0
    columns = _ordered_columns(config, config.restore_exclude)
    statement = _build_upsert_sql(config, columns)
    restored = 0
    for row in rows:
        result = await db.execute(statement, _prepare_row(config, row, user_id_map))
        restored += _result_count(result)
    return restored


async def _restore_users(db: DB, rows: list[dict[str, Any]]) -> tuple[int, dict[str, UUID], set[str]]:
    if not rows:
        return 0, {}, set()

    columns = _ordered_columns(USERS_CONFIG, USERS_CONFIG.restore_exclude)
    insert_columns = ', '.join(columns)
    value_sql = ', '.join(
        f'CAST(:{column} AS jsonb)' if isinstance(User.__table__.columns[column].type, JSONB) else f':{column}'
        for column in columns
    )
    insert_sql = text(
        f'INSERT INTO users ({insert_columns}) '
        f'VALUES ({value_sql}) '
        'ON CONFLICT (email) DO NOTHING '
        'RETURNING id'
    )
    lookup_sql = text('SELECT id FROM users WHERE email = :email')

    restored = 0
    user_id_map: dict[str, UUID] = {}
    inserted_emails: set[str] = set()

    for row in rows:
        prepared = _prepare_row(USERS_CONFIG, row, {})
        result = await db.execute(insert_sql, prepared)
        inserted_id = result.scalar_one_or_none()
        backup_id = row.get('id')
        if inserted_id is None:
            existing_id = (await db.execute(lookup_sql, {'email': row.get('email')})).scalar_one_or_none()
            if existing_id is not None and backup_id is not None:
                user_id_map[str(backup_id)] = existing_id
            continue
        restored += 1
        email = row.get('email')
        if email:
            inserted_emails.add(str(email))
        if backup_id is not None:
            user_id_map[str(backup_id)] = inserted_id

    return restored, user_id_map, inserted_emails


async def _restore_user_personal_projects(
    db: DB,
    rows: list[dict[str, Any]],
    inserted_emails: set[str],
) -> None:
    if not inserted_emails:
        return

    project_column = User.__table__.columns['personal_project_id']
    statement = text(
        'UPDATE users SET personal_project_id = :personal_project_id WHERE email = :email'
    )
    for row in rows:
        email = row.get('email')
        if email not in inserted_emails:
            continue
        await db.execute(
            statement,
            {
                'email': email,
                'personal_project_id': _coerce_bind_value(project_column, row.get('personal_project_id')),
            },
        )


async def _restore_skill_active_versions(db: DB, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return

    skill_id_column = Skill.__table__.columns['id']
    active_version_column = Skill.__table__.columns['active_version_id']
    statement = text(
        'UPDATE skills SET active_version_id = :active_version_id WHERE id = :id'
    )
    for row in rows:
        if row.get('id') is None:
            continue
        await db.execute(
            statement,
            {
                'id': _coerce_bind_value(skill_id_column, row.get('id')),
                'active_version_id': _coerce_bind_value(active_version_column, row.get('active_version_id')),
            },
        )


@router.get('')
async def backup_configuration(db: DB, user: AdminUser):
    del user

    payload = {
        'version': '1.0',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'data': {
            config.section: await _backup_section(db, config)
            for config in BACKUP_TABLES
        },
    }
    backup_bytes = json.dumps(payload, default=json_default).encode('utf-8')
    backup_date = datetime.now(timezone.utc).date().isoformat()
    return Response(
        content=backup_bytes,
        media_type='application/json',
        headers={
            'Content-Disposition': f'attachment; filename="conflux-backup-{backup_date}.json"',
        },
    )


@router.post('/restore')
async def restore_configuration_backup(
    background_tasks: BackgroundTasks,
    db: DB,
    user: AdminUser,
    file: UploadFile = File(...),
):
    del user

    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail='Invalid backup JSON file') from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Backup payload must be a JSON object')

    data = payload.get('data')
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail='Backup payload must include a data object')

    section_rows = {config.section: _section_rows(data, config.section) for config in BACKUP_TABLES}
    restored = {config.section: 0 for config in BACKUP_TABLES}

    restored[SYSTEM_SETTINGS_CONFIG.section] = await _restore_generic_section(
        db,
        SYSTEM_SETTINGS_CONFIG,
        section_rows[SYSTEM_SETTINGS_CONFIG.section],
        {},
    )
    restored[TENANTS_CONFIG.section] = await _restore_generic_section(
        db,
        TENANTS_CONFIG,
        section_rows[TENANTS_CONFIG.section],
        {},
    )
    restored[USERS_CONFIG.section], user_id_map, inserted_emails = await _restore_users(
        db,
        section_rows[USERS_CONFIG.section],
    )
    restored[PROJECTS_CONFIG.section] = await _restore_generic_section(
        db,
        PROJECTS_CONFIG,
        section_rows[PROJECTS_CONFIG.section],
        user_id_map,
    )
    restored[PROVIDERS_CONFIG.section] = await _restore_generic_section(
        db,
        PROVIDERS_CONFIG,
        section_rows[PROVIDERS_CONFIG.section],
        user_id_map,
    )
    restored[PROVIDER_MODELS_CONFIG.section] = await _restore_generic_section(
        db,
        PROVIDER_MODELS_CONFIG,
        section_rows[PROVIDER_MODELS_CONFIG.section],
        user_id_map,
    )
    restored[AGENTS_CONFIG.section] = await _restore_generic_section(
        db,
        AGENTS_CONFIG,
        section_rows[AGENTS_CONFIG.section],
        user_id_map,
    )
    restored[SKILLS_CONFIG.section] = await _restore_generic_section(
        db,
        SKILLS_CONFIG,
        section_rows[SKILLS_CONFIG.section],
        user_id_map,
    )
    restored[SKILL_VERSIONS_CONFIG.section] = await _restore_generic_section(
        db,
        SKILL_VERSIONS_CONFIG,
        section_rows[SKILL_VERSIONS_CONFIG.section],
        user_id_map,
    )
    restored[SKILL_FILES_CONFIG.section] = await _restore_generic_section(
        db,
        SKILL_FILES_CONFIG,
        section_rows[SKILL_FILES_CONFIG.section],
        user_id_map,
    )
    restored[TOOL_CONFIGS_CONFIG.section] = await _restore_generic_section(
        db,
        TOOL_CONFIGS_CONFIG,
        section_rows[TOOL_CONFIGS_CONFIG.section],
        user_id_map,
    )
    restored[MCP_SERVERS_CONFIG.section] = await _restore_generic_section(
        db,
        MCP_SERVERS_CONFIG,
        section_rows[MCP_SERVERS_CONFIG.section],
        user_id_map,
    )
    restored[SSO_PROVIDER_SETTINGS_CONFIG.section] = await _restore_generic_section(
        db,
        SSO_PROVIDER_SETTINGS_CONFIG,
        section_rows[SSO_PROVIDER_SETTINGS_CONFIG.section],
        user_id_map,
    )
    restored[API_KEYS_CONFIG.section] = await _restore_generic_section(
        db,
        API_KEYS_CONFIG,
        section_rows[API_KEYS_CONFIG.section],
        user_id_map,
    )
    restored[SCHEDULED_TASKS_CONFIG.section] = await _restore_generic_section(
        db,
        SCHEDULED_TASKS_CONFIG,
        section_rows[SCHEDULED_TASKS_CONFIG.section],
        user_id_map,
    )

    await _restore_user_personal_projects(db, section_rows[USERS_CONFIG.section], inserted_emails)
    await _restore_skill_active_versions(db, section_rows[SKILLS_CONFIG.section])
    await db.flush()

    background_tasks.add_task(_refresh_provider_registry_task)
    return {'restored': restored}
