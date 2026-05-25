# Contributing to Conflux

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/conflux.git
   cd conflux
   ```

2. **Install Python dependencies**
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   uv sync
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   
   cp ui/.env.example ui/.env.local
   # Edit ui/.env.local with your configuration
   ```

4. **Run migrations**
   ```bash
   uv run alembic upgrade head
   ```

5. **Start services**
   ```bash
   # Backend
   uv run uvicorn conflux.api.main:app --host 0.0.0.0 --port 8001 --reload
   
   # Frontend (separate terminal)
   cd ui && npm install && npm run dev
   ```

## Running Tests

```bash
uv run pytest -q
```

## Code Style

- Python: formatted with `ruff` — run `uv run ruff check .` before committing
- TypeScript: strict mode enabled — run `cd ui && npx tsc --noEmit` to check

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes with clear, focused commits
3. Run tests and linting
4. Open a PR with a description of what you changed and why

## Commit Messages

Use conventional commits format:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `refactor: improve code structure`
