# Conflux

> **Multi-user, self-learning AI Agent Harness** — v0.36.1

Conflux is a production-grade AI orchestration platform. An autonomous orchestrator agent dynamically spawns and manages worker colonies, routes tasks to the best-fit LLM provider, and continuously improves its own skills through a five-layer adaptive learning system — all behind a polished web UI.

---

## ✨ Highlights

| | Feature |
|---|---|
| 🤖 | **Autonomous orchestrator** — spawns, routes, and manages agent colonies dynamically |
| 🧠 | **Self-learning** — scoped memory, versioned skills, trace-driven reflection, eval-based evolution |
| 🔌 | **Multi-provider LLM** — Ollama, vLLM, llama.cpp, LM Studio, or any OpenAI-compatible endpoint |
| 👥 | **Multi-user** — Azure AD / Microsoft Entra ID SSO, GitHub, Google, OIDC, email+password |
| 📚 | **Knowledge Wiki** — hierarchical spaces, hybrid semantic+keyword search, automatic RAG injection |
| 🛠️ | **MCP support** — connect any Model Context Protocol server to any agent |
| 📅 | **Scheduled tasks** — natural-language cron scheduling, delivers to any channel |
| 📧 | **AgentMail** — give agents a real email address (send, receive, reply) |
| 💬 | **Discord bot** — first-class discord.py bot; @mention or DM triggers the full agent loop; slash commands, per-server routing, role ACL, emoji reactions |
| 📱 | **Telegram bot** — inline keyboards, agent loop, conversation history |
| 🔍 | **Admin observability** — request traces, audit trail, diagnostics, improvement pipeline |
| 💾 | **Full system backup** — ZIP export of all PostgreSQL tables + Qdrant vector snapshots |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Conflux UI (Next.js)                  │
│  Web Chat · Agents · Wiki · Admin · Diagnostics · Backup │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS / WebSocket
┌───────────────────────▼─────────────────────────────────┐
│                 Conflux API  (FastAPI)                   │
│                                                          │
│  /v1/runs     /v1/agents   /v1/memory    /v1/skills      │
│  /v1/sessions /v1/providers /v1/wiki     /v1/mcp         │
│  /v1/schedules /v1/tools   /v1/backup   /v1/chat/...     │
│  /v1/admin/{traces,audit,improvement,backup}             │
└──────┬──────────────────────────────────────┬───────────┘
       │                                      │
┌──────▼──────────┐                 ┌─────────▼──────────┐
│  Orchestrator   │                 │  Background Worker  │
│  Agent          │                 │  (arq)              │
│  ├─ Colony Mgr  │                 │  ├─ reflection_job  │
│  └─ Worker      │                 │  ├─ evolution_cycle │
│     Agents      │                 │  └─ tick_schedules  │
└──────┬──────────┘                 └────────────────────┘
       │ OpenAI-compatible
┌──────▼──────────────────────────────────────────────────┐
│               LLM Providers (hot-swappable)             │
│    Ollama · vLLM · llama.cpp · LM Studio · OpenAI API   │
└─────────────────────────────────────────────────────────┘

Infrastructure (Docker):
  PostgreSQL · DragonflyDB · Qdrant · SearXNG · faster-whisper
```

---

## 🐳 Quick Start (Docker — recommended)

### Prerequisites
- Docker + Docker Compose
- A running LLM endpoint (Ollama, vLLM, etc.)

### 1. Clone and configure

```bash
git clone https://github.com/AxiomOperator/conflux.git
cd conflux

cp .env.docker.example .env
cp ui/.env.docker.example ui/.env.local
```

Edit `.env` and fill in at minimum:

```ini
DATABASE_URL=postgresql+asyncpg://conflux:yourpassword@db:5432/conflux_core
JWT_SECRET=change-me-min-32-chars
API_KEY_PEPPER=change-me-min-32-chars
NEXTAUTH_SECRET=change-me-strong-random
NEXTAUTH_URL=https://your.domain.com
INTERNAL_API_SECRET=change-me-strong-random

# LLM provider (example: Ollama)
OLLAMA_BASE_URL=http://192.168.1.10:11434/v1
OLLAMA_DEFAULT_MODEL=qwen3:32b
```

### 2. Start everything

```bash
docker compose up -d
```

This starts **9 services** with proper health-check ordering:
- Infrastructure first: PostgreSQL, DragonflyDB, Qdrant, SearXNG, Valkey, faster-whisper
- Then: `conflux-api` (runs Alembic migrations automatically on first boot)
- Finally: `conflux-ui`, `conflux-worker`

### 3. First login

Open `http://localhost:3000` (or your configured domain). The **first user to sign in is automatically made admin** — no manual bootstrap required.

Add your LLM provider under **Admin → Providers**, then start chatting.

---

## 💻 Development Setup

```bash
# 1. Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install Python dependencies
cd conflux && uv sync

# 3. Install UI dependencies
cd ui && bun install

# 4. Configure environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL, DRAGONFLY_URL, QDRANT_URL, JWT_SECRET, etc.

# 5. Run database migrations
uv run alembic upgrade head

# 6. Start all services
./conflux.sh start
```

`conflux.sh` manages all local processes:

```bash
./conflux.sh start           # start API, worker, UI (dev mode)
./conflux.sh stop            # stop all services
./conflux.sh restart         # restart all services
./conflux.sh status          # show process status
./conflux.sh logs ui         # tail UI log
./conflux.sh logs api        # tail API log
./conflux.sh build           # production build (bun run build)
```

---

## 🔄 Docker Management

The `conflux.sh docker` subcommand wraps the full Docker rebuild/redeploy workflow:

```bash
./conflux.sh docker redeploy          # build UI → rebuild images → force-recreate all app containers
./conflux.sh docker redeploy ui       # rebuild & restart conflux-ui only
./conflux.sh docker redeploy api      # rebuild & restart conflux-api only
./conflux.sh docker redeploy worker   # rebuild & restart conflux-worker only
./conflux.sh docker build             # build Docker images (bun build for UI first)
./conflux.sh docker up                # recreate containers from existing images
./conflux.sh docker status            # show all container statuses + ports
./conflux.sh docker logs [service]    # tail logs for a specific container
```

---

## 🤖 Self-Learning Architecture

Conflux learns from every interaction through five adaptive layers:

| Layer | What it stores | When it runs |
|---|---|---|
| **Memory** | Scoped facts (user / project / tenant / agent / global) | During & after every run |
| **Session history** | Full traces: prompts, tool calls, errors, outcomes | During runs |
| **Skills** | Versioned procedural knowledge in SKILL.md format | Drafted after runs, requires admin approval |
| **Reflection** | Analyzes traces to decide what to learn | arq job after every completed run |
| **Evolution** | Eval-driven skill/prompt improvement proposals | Nightly; scored on 8 dimensions; requires admin approval |

**Key principle:** No global behavior changes without admin approval. Agents draft skills and write memories autonomously, but promotion always requires human review via the Improvement Pipeline.

---

## 🔌 LLM Providers

Add providers at runtime via **Admin → Providers** — no restart needed.

| Provider | Notes |
|---|---|
| **Ollama** | Local models — set `OLLAMA_BASE_URL` |
| **vLLM** | High-throughput inference — set `VLLM_BASE_URL` |
| **llama.cpp** | Server mode — set `LLAMACPP_BASE_URL` |
| **LM Studio** | Desktop server — set `LMSTUDIO_BASE_URL` |
| **Any OpenAI-compatible** | Add via the Providers page — supports custom base URL + API key |

Models are assigned per-agent. The system also exposes an OpenAI-compatible proxy at `/v1/chat/completions` for drop-in compatibility.

---

## 💬 Messaging Channels

Conflux runs full-featured bots — not just webhook relays. Every channel message routes through the same AgentLoop as the web UI.

### Discord (v0.36)

| Feature | Details |
|---|---|
| **Trigger** | @mention the bot in any channel, or DM it directly |
| **Account linking** | `/link api_key:<key>` — pairs your Discord account to your Conflux user |
| **Slash commands** | `/ask`, `/new`, `/me`, `/agents`, `/status`, `/unlink`, `/config` |
| **Per-server routing** | Map any text channel to a specific agent via Admin → Discord Bot |
| **Role ACL** | Restrict bot access to specific Discord roles per server |
| **Thread mode** | Each conversation reply is threaded to the original message |
| **Emoji reactions** | ⏳ on receipt → ✅ success / ❌ error |
| **Voice transcription** | Audio messages transcribed via faster-whisper before agent processing |
| **Admin UI** | Bot status, guild list, and per-guild config editor under Admin → Integrations → Discord |

Set `discord_bot_token` in **Admin → System Settings** (Messaging category) to enable.

### Telegram

- Commands: `/start`, `/help`, `/new`, `/agents`, `/link <api_key>`
- Inline keyboard navigation for agent selection
- Full conversation history and streaming responses
- Allowed user IDs configurable via Admin → System Settings (chip list)

---

## 📚 Knowledge Wiki

A full-featured wiki with agent RAG integration:

- **Hierarchical spaces and pages** with nested tree structure
- **Access control groups** with space-level and page-level ACL rules
- **Hybrid search** — Qdrant semantic search + PostgreSQL full-text search
- **File upload** — PDF and Markdown → auto-chunk → embed for instant search
- **Agent RAG injection** — wiki content is automatically injected into agent system prompts (per-agent toggle)
- **Markdown editor** with live preview and full version history
- **Admin panel** for groups, spaces, and access rules

---

## 🔐 Authentication

| Method | Description |
|---|---|
| **Microsoft Entra ID (Azure AD)** | Enterprise SSO via MSAL |
| **GitHub OAuth** | `GITHUB_ID` + `GITHUB_SECRET` |
| **Google OAuth** | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| **Generic OIDC** | Okta, Keycloak, Auth0, etc. — `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ISSUER` |
| **Email + Password** | Admin-created accounts, bcrypt hashing |
| **API Keys** | For CLI and programmatic access |

The login page dynamically shows only providers that are both configured and enabled by the admin.

---

## 🖥️ Admin Tools

| Tool | Path | Description |
|---|---|---|
| **Providers** | `/admin` | Manage LLM providers and model assignments |
| **Diagnostics** | `/admin/diagnostics` | Live health checks for all infrastructure services |
| **Request Traces** | `/admin/traces` | Every API call logged with method, path, status, duration, body previews |
| **Audit Trail** | `/admin/audit` | Every agent tool call, shell output, and error with full context |
| **Improvement Pipeline** | `/admin/improvement` | Pattern detection, evolution candidates, skill evaluations, eval cases |
| **System Settings** | `/admin/settings` | Runtime config overrides (no restart needed): embeddings, search, voice, integrations |
| **SSO Providers** | `/admin/sso` | Toggle auth providers, manage credentials users |
| **AgentMail** | `/admin/agentmail` | Agent email inboxes, message threads |
| **Discord Bot** | `/admin/discord` | Bot status, connected guilds, per-guild channel→agent routing and role ACL |
| **Trajectories** | `/admin/trajectories` | Completed runs for fine-tuning — approve/reject + JSONL export |
| **Backup & Restore** | `/admin/backup` | Full system ZIP (all PostgreSQL tables + Qdrant snapshots) or config-only JSON |
| **View as User** | (header toggle) | Admins preview the UI exactly as a regular user sees it |

---

## 💾 Backup & Restore

Two backup modes available from **Admin → Backup**:

**Full System Backup** (`.zip`) — recommended before container updates:
- All 40+ PostgreSQL tables (asyncpg-based, no pg_dump required)
- All 4 Qdrant vector collection snapshots (documents, memory, skills, wiki)
- App configuration JSON

**Config-only Backup** (`.json`):
- Settings, providers, agents, skills, users, scheduled tasks

---

## 🔧 CLI & API

```bash
# Install and configure
export CONFLUX_API_URL=http://localhost:8001
export CONFLUX_API_KEY=your-api-key

# Run a task (streams output)
conflux run task <agent-id> "Summarize the latest server logs"

# Check run status
conflux run status <run-id>

# Search memory
conflux memory search "kubernetes deployment strategy"

# Skill management
conflux skill list
conflux skill approve <skill-id>

# Rich TUI dashboard
conflux dashboard

# Interactive TUI chat
conflux tui chat <agent-id>

# Live run monitor
conflux tui monitor <run-id>
```

### API Endpoints

```
POST /v1/runs                    — create & stream agent runs
GET  /v1/runs/{id}/stream        — SSE stream of a run
GET  /v1/agents                  — list/create/update/delete agents
GET  /v1/memory                  — memory CRUD + semantic search
GET  /v1/skills                  — skill library + approval workflow
GET  /v1/providers               — LLM provider management
GET  /v1/sessions                — session + message history
GET  /v1/schedules               — cron-based scheduled tasks
GET  /v1/wiki/...                — wiki spaces, pages, search
GET  /v1/mcp                     — MCP server management
POST /v1/chat/completions        — OpenAI-compatible proxy
GET  /v1/backup/full             — full system backup (ZIP)
GET  /v1/backup                  — config backup (JSON)
GET  /v1/admin/traces            — request trace log
GET  /v1/admin/audit             — agent audit trail
GET  /v1/admin/improvement       — improvement pipeline
```

---

## ⚙️ Environment Variables

See `.env.example` for the full reference. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL asyncpg connection string |
| `DRAGONFLY_URL` | DragonflyDB (Redis-compatible) URL |
| `QDRANT_URL` | Qdrant vector store URL |
| `EMBEDDING_BASE_URL` | OpenAI-compatible embedding endpoint |
| `EMBEDDING_MODEL` | Embedding model name |
| `SEARXNG_URL` | SearXNG web search URL |
| `WHISPER_BASE_URL` | faster-whisper server URL |
| `JWT_SECRET` | JWT signing key (min 32 chars) |
| `API_KEY_PEPPER` | API key hashing pepper (min 32 chars) |
| `INTERNAL_API_SECRET` | Internal service-to-service secret |
| `NEXTAUTH_SECRET` | NextAuth.js signing secret |
| `NEXTAUTH_URL` | Public URL of the UI |
| `AZURE_AD_CLIENT_ID` | Microsoft Entra ID app client ID |
| `AZURE_AD_TENANT_ID` | Azure AD tenant ID |
| `GITHUB_ID` / `GITHUB_SECRET` | GitHub OAuth credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_ISSUER` | Generic OIDC provider |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token (or set via Admin → System Settings) |
| `DATA_GUARD_ENABLED` | Block destructive tools in dev (default: `false`) |

---

## 🏛️ Infrastructure

| Service | Default Port | Purpose |
|---|---|---|
| **PostgreSQL** | 5432 | Durable state — sessions, memories, audit trail, wiki, traces |
| **DragonflyDB** | 6379 | Cache + arq job queue (Redis-compatible) |
| **Qdrant** | 6333 | Vector store — memory, skills, documents, wiki |
| **SearXNG** | 8080 | Agent web search tool |
| **faster-whisper** | 8000 | Voice transcription (optional) |
| **Valkey** | 6379 | Session store (NextAuth.js) |

All services are included in `docker-compose.yml`. External services (e.g., an existing PostgreSQL instance) can be pointed to via environment variables.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

