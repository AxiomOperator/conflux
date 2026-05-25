"""Backup and restore routes for configuration data."""
from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg
import httpx
import structlog
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import DateTime, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from conflux.api.auth import AdminUser
from conflux.api.deps import DB
from conflux.core.config import get_settings
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


# ── Full Backup (PostgreSQL + Qdrant + Config) ────────────────────────────────

def _pg_url(database_url: str) -> str:
    """Convert SQLAlchemy asyncpg URL to a plain asyncpg URL."""
    return (
        database_url
        .replace('postgresql+asyncpg://', 'postgresql://')
        .replace('postgresql+psycopg2://', 'postgresql://')
    )


def _full_json_default(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (bytes, bytearray, memoryview)):
        return obj.hex() if isinstance(obj, (bytes, bytearray)) else bytes(obj).hex()
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    try:
        return str(obj)
    except Exception:
        raise TypeError(f'Not serializable: {type(obj)}') from None


async def _dump_postgres_tables(database_url: str) -> dict[str, list[dict[str, Any]]]:
    conn = await asyncpg.connect(_pg_url(database_url))
    try:
        table_rows = await conn.fetch(
            "SELECT tablename FROM pg_catalog.pg_tables "
            "WHERE schemaname='public' AND tablename != 'alembic_version' "
            "ORDER BY tablename"
        )
        result: dict[str, list[dict[str, Any]]] = {}
        for row in table_rows:
            table = row['tablename']
            try:
                rows = await conn.fetch(f'SELECT * FROM "{table}"')
                result[table] = [dict(r) for r in rows]
            except Exception as exc:
                logger.warning('pg_dump_table_failed', table=table, error=str(exc))
                result[table] = []
        return result
    finally:
        await conn.close()


async def _restore_postgres_table(
    conn: asyncpg.Connection,
    table: str,
    rows: list[dict[str, Any]],
) -> int:
    if not rows:
        return 0

    col_info = await conn.fetch(
        'SELECT column_name, data_type, udt_name '
        'FROM information_schema.columns '
        "WHERE table_schema='public' AND table_name=$1 "
        'ORDER BY ordinal_position',
        table,
    )
    if not col_info:
        return 0

    pk_info = await conn.fetch(
        'SELECT kcu.column_name '
        'FROM information_schema.table_constraints tc '
        'JOIN information_schema.key_column_usage kcu '
        '    ON tc.constraint_name = kcu.constraint_name '
        '    AND tc.table_schema = kcu.table_schema '
        "WHERE tc.constraint_type = 'PRIMARY KEY' "
        "AND tc.table_schema = 'public' AND tc.table_name = $1 "
        'ORDER BY kcu.ordinal_position',
        table,
    )
    pk_set = {r['column_name'] for r in pk_info}

    all_cols = {r['column_name']: (r['data_type'], r['udt_name']) for r in col_info}
    available = set(rows[0].keys())
    cols = [c for c in all_cols if c in available]
    if not cols:
        return 0

    def cast_placeholder(col: str, idx: int) -> str:
        data_type, udt_name = all_cols[col]
        if udt_name == 'uuid':
            return f'${idx}::uuid'
        if data_type in ('jsonb', 'json') or udt_name in ('jsonb', 'json'):
            return f'${idx}::jsonb'
        if 'timestamp' in data_type:
            return f'${idx}::timestamptz'
        if udt_name == 'inet':
            return f'${idx}::inet'
        return f'${idx}'

    cols_sql = ', '.join(f'"{c}"' for c in cols)
    vals_sql = ', '.join(cast_placeholder(c, i + 1) for i, c in enumerate(cols))
    pk_in_cols = [c for c in pk_set if c in cols]
    non_pk_cols = [c for c in cols if c not in pk_set]

    if pk_in_cols and non_pk_cols:
        conflict_sql = (
            f'ON CONFLICT ({", ".join(pk_in_cols)}) DO UPDATE SET '
            + ', '.join(f'"{c}" = EXCLUDED."{c}"' for c in non_pk_cols)
        )
    elif pk_in_cols:
        conflict_sql = f'ON CONFLICT ({", ".join(pk_in_cols)}) DO NOTHING'
    else:
        conflict_sql = ''

    sql = f'INSERT INTO "{table}" ({cols_sql}) VALUES ({vals_sql}) {conflict_sql}'

    def coerce(col: str, val: Any) -> Any:
        if val is None:
            return None
        data_type, udt_name = all_cols[col]
        if data_type in ('jsonb', 'json') or udt_name in ('jsonb', 'json'):
            if isinstance(val, (dict, list)):
                return json.dumps(val)
            return str(val)
        return val

    records = [tuple(coerce(c, row.get(c)) for c in cols) for row in rows]

    try:
        await conn.executemany(sql, records)
        return len(records)
    except Exception as exc:
        logger.warning('pg_restore_table_failed', table=table, error=str(exc))
        return 0


async def _backup_qdrant_collection(qdrant_url: str, collection: str, api_key: str) -> bytes:
    headers = {'api-key': api_key} if api_key else {}
    async with httpx.AsyncClient(headers=headers) as client:
        resp = await client.post(
            f'{qdrant_url}/collections/{collection}/snapshots',
            timeout=120.0,
        )
        resp.raise_for_status()
        snapshot_name = resp.json()['result']['name']

        download = await client.get(
            f'{qdrant_url}/collections/{collection}/snapshots/{snapshot_name}',
            timeout=300.0,
        )
        download.raise_for_status()
        return download.content


async def _restore_qdrant_collection(qdrant_url: str, collection: str, snapshot_bytes: bytes, api_key: str) -> None:
    headers = {'api-key': api_key} if api_key else {}
    async with httpx.AsyncClient(headers=headers) as client:
        resp = await client.post(
            f'{qdrant_url}/collections/{collection}/snapshots/upload?priority=snapshot',
            files={'snapshot': (f'{collection}.snapshot', snapshot_bytes, 'application/octet-stream')},
            timeout=300.0,
        )
        resp.raise_for_status()


@router.get('/full')
async def backup_full(db: DB, user: AdminUser) -> Response:
    """Create a full backup ZIP: app config + all PostgreSQL tables + Qdrant snapshots."""
    del user

    settings = get_settings()
    backup_date = datetime.now(timezone.utc).date().isoformat()

    zip_buffer = io.BytesIO()
    postgres_tables: list[str] = []
    qdrant_collections: list[str] = [
        settings.qdrant_collection_documents,
        settings.qdrant_collection_memory,
        settings.qdrant_collection_skills,
        settings.qdrant_collection_wiki,
    ]

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. App config (settings, providers, agents, etc.)
        config_payload = {
            'version': '1.0',
            'created_at': datetime.now(timezone.utc).isoformat(),
            'data': {
                cfg.section: await _backup_section(db, cfg)
                for cfg in BACKUP_TABLES
            },
        }
        zf.writestr('config.json', json.dumps(config_payload, default=json_default))

        # 2. Full PostgreSQL dump
        try:
            pg_tables = await _dump_postgres_tables(settings.database_url)
            postgres_tables = list(pg_tables.keys())
            for table_name, rows in pg_tables.items():
                zf.writestr(
                    f'postgres/{table_name}.json',
                    json.dumps(rows, default=_full_json_default),
                )
            logger.info('full_backup_postgres_ok', tables=len(postgres_tables))
        except Exception as exc:
            logger.error('full_backup_postgres_failed', error=str(exc))
            zf.writestr('postgres/_error.txt', str(exc))

        # 3. Qdrant collection snapshots
        successful_qdrant: list[str] = []
        for collection in qdrant_collections:
            try:
                snapshot_bytes = await _backup_qdrant_collection(
                    settings.qdrant_url, collection, settings.qdrant_api_key
                )
                zf.writestr(f'qdrant/{collection}.snapshot', snapshot_bytes)
                successful_qdrant.append(collection)
                logger.info('full_backup_qdrant_ok', collection=collection, size=len(snapshot_bytes))
            except Exception as exc:
                logger.warning('full_backup_qdrant_failed', collection=collection, error=str(exc))
                zf.writestr(f'qdrant/{collection}_error.txt', str(exc))

        # 4. Manifest
        manifest = {
            'version': '2.0',
            'type': 'full',
            'created_at': datetime.now(timezone.utc).isoformat(),
            'includes': ['config', 'postgres', 'qdrant'],
            'postgres_tables': postgres_tables,
            'qdrant_collections': successful_qdrant,
        }
        zf.writestr('manifest.json', json.dumps(manifest, indent=2))

    return Response(
        content=zip_buffer.getvalue(),
        media_type='application/zip',
        headers={
            'Content-Disposition': f'attachment; filename="conflux-full-backup-{backup_date}.zip"',
        },
    )


@router.post('/restore/full')
async def restore_full_backup(
    background_tasks: BackgroundTasks,
    db: DB,
    user: AdminUser,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Restore a full backup ZIP: app config + PostgreSQL tables + Qdrant snapshots."""
    del user

    settings = get_settings()
    zip_data = await file.read()

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_data), 'r')
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail='Invalid ZIP file') from exc

    with zf:
        namelist = zf.namelist()
        results: dict[str, Any] = {'config': {}, 'postgres': {}, 'qdrant': {}}

        # 1. Restore app config
        if 'config.json' in namelist:
            try:
                config_payload = json.loads(zf.read('config.json'))
                data = config_payload.get('data', {})
                if isinstance(data, dict):
                    section_rows = {cfg.section: _section_rows(data, cfg.section) for cfg in BACKUP_TABLES}
                    restored_config: dict[str, int] = {}

                    restored_config[SYSTEM_SETTINGS_CONFIG.section] = await _restore_generic_section(
                        db, SYSTEM_SETTINGS_CONFIG, section_rows[SYSTEM_SETTINGS_CONFIG.section], {}
                    )
                    restored_config[TENANTS_CONFIG.section] = await _restore_generic_section(
                        db, TENANTS_CONFIG, section_rows[TENANTS_CONFIG.section], {}
                    )
                    restored_config[USERS_CONFIG.section], user_id_map, inserted_emails = await _restore_users(
                        db, section_rows[USERS_CONFIG.section]
                    )
                    restored_config[PROJECTS_CONFIG.section] = await _restore_generic_section(
                        db, PROJECTS_CONFIG, section_rows[PROJECTS_CONFIG.section], user_id_map
                    )
                    for cfg in (
                        PROVIDERS_CONFIG, PROVIDER_MODELS_CONFIG, AGENTS_CONFIG,
                        SKILLS_CONFIG, SKILL_VERSIONS_CONFIG, SKILL_FILES_CONFIG,
                        TOOL_CONFIGS_CONFIG, MCP_SERVERS_CONFIG, SSO_PROVIDER_SETTINGS_CONFIG,
                        API_KEYS_CONFIG, SCHEDULED_TASKS_CONFIG,
                    ):
                        restored_config[cfg.section] = await _restore_generic_section(
                            db, cfg, section_rows[cfg.section], user_id_map
                        )
                    await _restore_user_personal_projects(
                        db, section_rows[USERS_CONFIG.section], inserted_emails
                    )
                    await _restore_skill_active_versions(db, section_rows[SKILLS_CONFIG.section])
                    await db.flush()
                    results['config'] = restored_config
            except Exception as exc:
                logger.error('full_restore_config_failed', error=str(exc))
                results['config'] = {'error': str(exc)}

        # 2. Restore PostgreSQL tables
        pg_files = sorted(n for n in namelist if n.startswith('postgres/') and n.endswith('.json'))
        if pg_files:
            conn = await asyncpg.connect(_pg_url(settings.database_url))
            try:
                for pg_file in pg_files:
                    table_name = pg_file[len('postgres/'):-len('.json')]
                    try:
                        rows = json.loads(zf.read(pg_file))
                        count = await _restore_postgres_table(conn, table_name, rows)
                        results['postgres'][table_name] = count
                    except Exception as exc:
                        logger.warning('full_restore_pg_table_failed', table=table_name, error=str(exc))
                        results['postgres'][table_name] = f'error: {exc}'
            finally:
                await conn.close()

        # 3. Restore Qdrant snapshots
        snap_files = [n for n in namelist if n.startswith('qdrant/') and n.endswith('.snapshot')]
        for snap_file in snap_files:
            collection_name = snap_file[len('qdrant/'):-len('.snapshot')]
            try:
                snapshot_bytes = zf.read(snap_file)
                await _restore_qdrant_collection(
                    settings.qdrant_url, collection_name, snapshot_bytes, settings.qdrant_api_key
                )
                results['qdrant'][collection_name] = 'restored'
                logger.info('full_restore_qdrant_ok', collection=collection_name)
            except Exception as exc:
                logger.warning('full_restore_qdrant_failed', collection=collection_name, error=str(exc))
                results['qdrant'][collection_name] = f'error: {exc}'

    background_tasks.add_task(_refresh_provider_registry_task)
    return {'restored': results}


@router.get('')
async def backup_configuration(db: DB, user: AdminUser):

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
