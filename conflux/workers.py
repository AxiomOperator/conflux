"""
arq background worker.
Start with: arq conflux.workers.WorkerSettings
"""
from arq import cron
from arq.connections import RedisSettings

from conflux.core.config import get_settings
from conflux.learning.evolution import run_evolution_cycle
from conflux.learning.reflection import reflection_job
from conflux.learning.skill_evaluator import skill_evaluation_job
from conflux.scheduler.runner import tick_schedules


async def startup(ctx: dict) -> None:
    from conflux.core.logging import configure_logging
    from conflux.providers.registry import refresh_provider_registry

    configure_logging()
    await refresh_provider_registry()
    import structlog

    structlog.get_logger("workers").info("Conflux worker started")


async def shutdown(ctx: dict) -> None:
    from conflux.core.cache import close_redis
    from conflux.core.database import dispose_engine

    await close_redis()
    await dispose_engine()


class WorkerSettings:
    functions = [reflection_job, skill_evaluation_job, run_evolution_cycle, tick_schedules]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().dragonfly_url)
    cron_jobs = [
        cron(run_evolution_cycle, hour={0, 6, 12, 18}, minute=0),
        cron(tick_schedules, second=0),
    ]
    max_jobs = 10
    job_timeout = 300
