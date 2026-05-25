# Changelog

All notable changes to Conflux are documented here.

---

## [Unreleased]

### Added
- **Synapse** — standalone real-time neural-network visualization app (`/root/synapse/`)
  - Live force-directed graph of agents, tools, memory, learning events
  - SSE stream consumed from Conflux DragonflyDB event stream (`synapse:events`)
  - Node type filter pills (agent / tool / memory / learning / user)
  - Activity feed, node inspector panel, neural grid background
  - Runs as a separate Next.js 14 app on port 3001
- **Synapse event publishing** in Conflux backend
  - `conflux/core/events.py` — `publish_event()` writing to DragonflyDB stream
  - Hooks in `agents/loop.py`, `agents/colony.py`, `memory/manager.py`, `learning/reflection.py`
- **SSE events API** — `/v1/events/stream` (live SSE) and `/v1/events/history` (REST)
  - No authentication required (read-only telemetry)
  - Keepalive pings every 15 seconds
- **CORS fix** — `SYNAPSE_URL` setting added; Synapse origin now included in production `allow_origins`
- **Tools management** section in admin area (view, add, edit, remove tools)
- **Per-user workspaces** — each user gets isolated workspace, memory, and orchestrator
- **Admin tools** — admin section with tools CRUD and management UI
- **Synapse nav link** in Conflux dashboard sidebar (external link, opens in new tab)
- **`conflux.sh`** extended with `synapse` target (start/stop/restart/build/redeploy/status/logs)

### Fixed
- Synapse SSE stream "Reconnecting" — removed `CurrentUser` auth requirement from events endpoints; fixed CORS to allow `synapse.example.com` domain
- Synapse process daemonisation — `bun` ignores `nohup`; fixed with `setsid bash -c "..."` pattern
- Auth proxy token passthrough for new agent auth chain
- Colony spawn tools auth fixes
- Provider model assignment for agents

### Changed
- `conflux/api/main.py` — CORS `allow_origins` in production now includes both `nextauth_url` and `synapse_url`
- Nginx removed from Synapse deployment (user has own reverse proxy)
- Synapse listens on `0.0.0.0:3001` (was `localhost` by default)

---

## [0.1.0] — Initial Foundation

### Added
- Multi-user AI agent harness core
- PostgreSQL + Qdrant + DragonflyDB + SearXNG + faster-whisper integration
- SSO auth (Microsoft Entra ID / Azure AD) via NextAuth
- Agent loop with tool execution, memory search, reflection/learning
- Colony (sub-agent spawn + hive swarm)
- Multi-provider LLM support (admin-assignable per task)
- Skills system
- Admin UI (providers, users, agents, tools, workspaces)
- Self-learning via adaptive reflection pipeline
