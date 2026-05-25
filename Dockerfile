FROM python:3.12-slim

# System deps for psycopg2/asyncpg native builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies (cached layer — only re-runs if lockfile changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application source
COPY conflux/ ./conflux/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# Create runtime directories
RUN mkdir -p .conflux workspace skills

# Default: API server
# Override command in docker-compose for the worker
CMD ["uv", "run", "uvicorn", "conflux.api.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
