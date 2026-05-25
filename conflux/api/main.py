"""FastAPI application factory."""
import asyncio
import traceback
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from conflux.api.middleware.trace import RequestTraceMiddleware
from conflux.api.routes.events import router as events_router

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    from conflux.core.logging import configure_logging
    from conflux.core.vector import ensure_collections
    from conflux.services.system_settings import bootstrap_runtime_settings

    configure_logging()
    logger.info("Conflux starting up")

    await bootstrap_runtime_settings()
    await ensure_collections()

    from conflux.providers.registry import refresh_provider_registry
    registry = await refresh_provider_registry()
    asyncio.create_task(_background_health_check(registry))

    # Reset any runs stuck in "running" or "queued" from a previous process crash
    await _reset_stale_runs()

    # Apply any DB tool overrides / custom tools to the live registry
    await _load_tool_configs()

    # Start Telegram bot if configured
    telegram_task = None
    from conflux.core.config import get_settings
    if get_settings().telegram_bot_token:
        from conflux.channels.telegram import run_telegram_bot
        telegram_task = asyncio.create_task(run_telegram_bot())
        logger.info("Telegram bot task started")

    yield

    if telegram_task and not telegram_task.done():
        telegram_task.cancel()
        try:
            await telegram_task
        except asyncio.CancelledError:
            pass

    from conflux.core.cache import close_redis
    from conflux.core.database import dispose_engine
    from conflux.core.vector import close_qdrant

    await close_redis()
    await close_qdrant()
    await dispose_engine()
    logger.info("Conflux shutdown complete")


async def _load_tool_configs() -> None:
    """Load DB tool configurations and apply them to the live tool registry."""
    from sqlalchemy import select

    from conflux.core.database import get_db_session
    from conflux.models.tool import ToolConfig
    from conflux.tools.registry import get_tool_registry

    try:
        async with get_db_session() as db:
            result = await db.execute(select(ToolConfig))
            configs = [
                {
                    "name": c.name,
                    "is_builtin": c.is_builtin,
                    "is_enabled": c.is_enabled,
                    "description_override": c.description_override,
                    "risk_level": c.risk_level,
                    "requires_approval": c.requires_approval,
                    "endpoint_url": c.endpoint_url,
                    "http_method": c.http_method,
                    "custom_headers": c.custom_headers,
                    "custom_parameters": c.custom_parameters,
                }
                for c in result.scalars().all()
            ]
        if configs:
            get_tool_registry().apply_db_configs(configs)
            logger.info("Tool configs loaded from DB", count=len(configs))
    except Exception as exc:
        logger.warning("Failed to load tool configs", error=str(exc))


async def _reset_stale_runs() -> None:
    """Mark runs stuck in running/queued at startup as failed (process was killed)."""
    from sqlalchemy import update

    from conflux.core.database import get_db_session
    from conflux.models.agent import AgentRun

    try:
        async with get_db_session() as db:
            result = await db.execute(
                update(AgentRun)
                .where(AgentRun.status.in_(["running", "queued"]))
                .values(status="failed", error="Process restarted — run interrupted")
                .returning(AgentRun.id)
            )
            stale = result.scalars().all()
            if stale:
                logger.warning("Reset stale runs on startup", count=len(stale))
    except Exception as exc:
        logger.warning("Failed to reset stale runs", error=str(exc))


async def _background_health_check(registry) -> None:
    """Run provider health checks in the background without blocking startup."""
    try:
        health = await asyncio.wait_for(registry.health_check_all(), timeout=15.0)
        for name, ok in health.items():
            logger.info("provider_health", provider=name, healthy=ok)
    except asyncio.TimeoutError:
        logger.warning("provider_health_checks_timed_out")
    except Exception as exc:
        logger.warning("provider_health_checks_failed", error=str(exc))


def create_app() -> FastAPI:
    from conflux.core.config import get_settings

    settings = get_settings()

    app = FastAPI(
        title="Conflux API",
        description="Multi-user, self-learning AI Agent Harness",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.is_dev else list(filter(None, [settings.nextauth_url, settings.synapse_url])),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestTraceMiddleware)

    from conflux.api.routes import (
        admin,
        agents,
        compat,
        doctor,
        insights,
        memory,
        onboarding,
        personality,
        providers,
        runs,
        schedules,
        sessions,
        skills,
        tools,
        trajectories,
        tts,
        users,
    )
    from conflux.api.routes import system_settings as system_settings_routes
    from conflux.api.routes import agentmail as agentmail_routes
    from conflux.api.routes import audit as audit_routes
    from conflux.api.routes import improvement as improvement_routes
    from conflux.api.routes import mcp as mcp_routes
    from conflux.api.routes import sso as sso_routes
    from conflux.api.routes import traces as traces_routes
    from conflux.api.routes import wiki as wiki_routes
    from conflux.api.routes import wiki_search as wiki_search_routes

    app.include_router(agents.router, prefix="/v1/agents", tags=["agents"])
    app.include_router(runs.router, prefix="/v1/runs", tags=["runs"])
    app.include_router(doctor.router, prefix="/v1", tags=["doctor"])
    app.include_router(insights.router, prefix="/v1", tags=["insights"])
    app.include_router(doctor.admin_router, prefix="/v1/admin", tags=["doctor"])
    app.include_router(schedules.router, prefix="/v1/schedules", tags=["schedules"])
    app.include_router(sessions.router, prefix="/v1/sessions", tags=["sessions"])
    app.include_router(memory.router, prefix="/v1/memory", tags=["memory"])
    app.include_router(onboarding.router, prefix="/v1/onboarding", tags=["onboarding"])
    app.include_router(personality.router, prefix="/v1", tags=["personality"])
    app.include_router(skills.router, prefix="/v1/skills", tags=["skills"])
    app.include_router(providers.router, prefix="/v1/providers", tags=["providers"])
    app.include_router(users.router, prefix="/v1/users", tags=["users"])
    app.include_router(admin.router, prefix="/v1/admin", tags=["admin"])
    app.include_router(system_settings_routes.router, prefix="/v1/admin", tags=["admin"])
    app.include_router(traces_routes.router, prefix="/v1/admin", tags=["admin"])
    app.include_router(audit_routes.router, prefix="/v1/admin", tags=["admin"])
    app.include_router(improvement_routes.router, prefix="/v1/admin", tags=["admin"])
    app.include_router(agentmail_routes.router, prefix="/v1/admin")
    app.include_router(tools.router, prefix="/v1/tools", tags=["tools"])
    app.include_router(trajectories.router, prefix="/v1")
    app.include_router(mcp_routes.router, prefix="/v1/mcp", tags=["mcp"])
    app.include_router(tts.router, prefix="/v1/tts", tags=["tts"])
    app.include_router(sso_routes.router, prefix="/v1", tags=["sso"])
    app.include_router(wiki_routes.router, tags=["wiki"])
    app.include_router(wiki_search_routes.router)
    app.include_router(events_router)
    app.include_router(compat.router, prefix="/v1", tags=["openai-compat"])

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Catch-all handler: log the full traceback and return a structured error body."""
        error_type = type(exc).__name__
        error_msg = str(exc)
        logger.error(
            "unhandled_exception",
            method=request.method,
            path=request.url.path,
            error_type=error_type,
            error=error_msg,
            traceback=traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500,
            content={"detail": f"{error_type}: {error_msg}", "error": "internal_server_error"},
        )

    @app.get('/health')
    async def health_check():
        return {'status': 'ok', 'service': 'conflux'}

    return app


app = create_app()
