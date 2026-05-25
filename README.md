# Conflux

**Multi-user, self-learning AI Agent Harness**

Conflux is a production-grade AI agent harness with a fully autonomous orchestrator that dynamically spawns and manages a colony of worker agents. It learns from every interaction through a five-layer adaptive learning system.

## Features

- **Fully autonomous orchestrator** — spawns, routes, and manages agent colonies dynamically
- **Self-learning** — scoped memory, versioned skills, trace recording, reflection workers, eval-driven evolution
- **Multi-provider LLM** — Ollama, vLLM, llama.cpp, LM Studio — unified adapter, hot-add support
- **Multi-user** — Microsoft Entra ID (Azure AD) SSO + API key auth, RBAC
- **Multi-channel** — REST API, CLI, Telegram, Voice (faster-whisper), Teams
- **Approval workflows** — agent-proposed skills and evolutions require admin approval before promotion

## Infrastructure Requirements

Conflux requires the following services. All URLs are configurable via environment variables.

| Service | Default Port | Purpose |
|---|---|---|
| PostgreSQL | 5432 | Durable state, sessions, audit trail |
| DragonflyDB (Redis-compatible) | 6379 | Cache + job queue |
| Qdrant | 6333 | Vector store (memory, skills, docs) |
| SearXNG | 8080 | Web search tool |
| faster-whisper-server | 8000 | Voice transcription (optional) |

> **Docker Compose** — A `docker-compose.yml` for local development is included. See [Setup Guide](docs/setup.md).

## Quick Start

```bash
# 1. Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install dependencies
cd conflux
uv sync

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL, DRAGONFLY_URL, Azure AD credentials, etc.

# 4. Run database migrations
uv run alembic upgrade head

# 5. Start the API server
uv run uvicorn conflux.api.main:app --host 0.0.0.0 --port 3000 --reload

# 6. Start the background worker (separate terminal)
uv run arq conflux.workers.WorkerSettings

# 7. (Optional) Start the Telegram bot (separate terminal)
uv run python -c "import asyncio; from conflux.channels.telegram import run_telegram_bot; asyncio.run(run_telegram_bot())"
```

## CLI Usage

```bash
export CONFLUX_API_URL=http://localhost:3000
export CONFLUX_API_KEY=your-api-key

# Run a task on an agent (streams output to terminal)
conflux run task <agent-id> "Analyze the latest server logs and summarize findings"

# Check run status
conflux run status <run-id>

# List recent runs
conflux run list -n 20

# List agents
conflux agent list

# Show agent details
conflux agent get <agent-id>

# Search memory semantically
conflux memory search "kubernetes deployment strategy"

# Write a memory
conflux memory write "preferred-language" "Always use Python for backend tasks"

# List skills
conflux skill list

# View skill content
conflux skill get <slug>

# Admin: view pending skills
conflux skill pending

# Admin: approve a skill
conflux skill approve <skill-id>

# Check provider health
conflux provider health

# Admin: view system stats
conflux admin stats

# Admin: list evolution candidates
conflux admin evolution-list

# Admin: approve an evolution candidate
conflux admin evolution-approve <candidate-id>
```

## Self-Learning Architecture

Conflux uses five adaptive learning layers:

| Layer | What it stores | When it runs |
|---|---|---|
| **Memory** | Scoped facts (user/project/tenant/agent/global) | During & after runs |
| **Session history** | Full traces: prompts, tool calls, errors, outcomes | During runs |
| **Skills** | Versioned procedural knowledge (SKILL.md format) | Drafted after runs, approved by admin |
| **Reflection** | Analyzes traces to decide what to learn | After every completed run (arq job) |
| **Evolution** | Eval-driven skill/prompt improvement proposals | Nightly (requires admin approval) |

**Key principle:** No global behavior changes without admin approval. Agents can draft skills and write memories. Skill promotion and evolution candidates always require human review.

## Environment Variables

See `.env.example` for full reference. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres asyncpg connection string |
| `DRAGONFLY_URL` | DragonflyDB (Redis-compatible) URL |
| `QDRANT_URL` | Qdrant vector store URL |
| `EMBEDDING_BASE_URL` | OpenAI-compatible embedding endpoint |
| `AZURE_AD_CLIENT_ID` | Microsoft Entra ID app client ID |
| `AZURE_AD_TENANT_ID` | Azure AD tenant ID |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DATA_GUARD_ENABLED` | Block destructive tools in dev (default: false) |

## Architecture

```
Conflux API (FastAPI, port 3000)
  ├── /v1/runs        — create & stream agent runs
  ├── /v1/agents      — agent CRUD
  ├── /v1/memory      — memory CRUD + search
  ├── /v1/skills      — skill library + approvals
  ├── /v1/providers   — LLM provider management
  ├── /v1/users       — user + API key management
  ├── /v1/admin       — stats, reflection, evolution
  └── /v1/chat/completions — OpenAI-compatible proxy

Orchestrator Agent
  └── Colony Manager → spawns/manages Worker Agents

Background Workers (arq)
  ├── reflection_job  — post-run learning (after every run)
  └── evolution_cycle — nightly skill optimization

Channels
  ├── Telegram Bot
  ├── Voice (faster-whisper STT)
  └── Teams (webhook)
```

## License

MIT License — see [LICENSE](LICENSE) for details.
