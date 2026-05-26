# Conflux — Feature Analysis & Competitive Roadmap

## Overview

Conflux is a self-learning, multi-user AI Agent Harness built for enterprise and team deployments. This document provides a comprehensive review of current capabilities, competitive gaps against leading open-source agent frameworks, and a prioritized feature roadmap.

---

## Current Capabilities (v0.36.x)

### Core Platform
| Feature | Status | Notes |
|---------|--------|-------|
| Multi-user with RBAC | ✅ Live | Admin, user, and read-only roles |
| Azure AD / SSO | ✅ Live | OIDC via NextAuth |
| API Key authentication | ✅ Live | Per-user scoped keys |
| Admin panel | ✅ Live | Full provider, agent, user, skill, wiki, and system settings management |
| System Settings | ✅ Live (v0.35.3) | 21 runtime settings in DB — embedding, search, voice, messaging, integrations; .env is fallback |
| Request Trace Log | ✅ Live (v0.35.5) | Full audit log of every API call — method, path, status, duration, user, body previews; filterable admin UI |
| Agent Audit Trail | ✅ v0.35.6 | Complete log of tool calls, shell commands, and errors per agent run |
| Skill Improvement Pipeline | ✅ v0.35.7 | Automated pattern detection, eval-driven candidate generation, Promote/Reject/Quarantine decisions |
| Full System Backup & Restore | ✅ v0.35.17 | ZIP export of all PostgreSQL tables + Qdrant snapshots; ZIP restore via upsert + snapshot upload |
| Dark/light theme | ✅ Live | Next-themes with system preference |
| Web dashboard | ✅ Live | Chat, Runs, Colony, Memory, Skills, Providers, Settings |

### Agent Engine
| Feature | Status | Notes |
|---------|--------|-------|
| Agent loop (tool-use) | ✅ Live | Iterative loop with tool call/result cycle |
| Agent Colony / Hive Swarm | ✅ Live | Orchestrator + worker topology |
| Sub-agent spawning | ✅ Live | Colony worker agents |
| 5-layer self-learning | ✅ Live | Tracer → reflection → evolution pipeline |
| Multiple LLM providers | ✅ Live | Ollama, vLLM, llama.cpp, LM Studio, OpenAI-compat |
| Provider assignment per agent | ✅ Live | Admin assigns model/provider per agent |
| Streaming responses | ✅ Live | SSE token streaming to UI and Telegram |
| Run history & events | ✅ Live | RunEvent table, events API |
| Token usage tracking | ✅ Live | Prompt + completion tokens per run |

### Skills & Tools
| Feature | Status | Notes |
|---------|--------|-------|
| Skills system | ✅ Live | Versioned, admin-approved, Python execution |
| SkillsMP marketplace | ✅ Live | Browse and install community skills |
| Skill approval workflow | ✅ Live | Admin must approve before deployment |
| Built-in tools | ✅ Live | shell, fetch, web_search, weather, memory, skill, colony, agentmail |
| Tool registry | ✅ Live | Dynamic registration, risk levels, approval gates |

### Memory & Knowledge
| Feature | Status | Notes |
|---------|--------|-------|
| Vector memory (Qdrant) | ✅ Live | Semantic search over past context |
| Run/conversation history | ✅ Live | PostgreSQL-backed, per-user |
| Memory dashboard | ✅ Live | View, search, delete memory entries |
| User persona modeling | ✅ Live | SOUL.md, AGENTS.md, identity/user/tools — editable in Settings, injected into every agent run |
| Context files (AGENTS.md) | ✅ Live | Per-user `agents_md` in `UserPersonaFiles`, multi-file: SOUL, AGENTS, identity, user, tools |
| Memory keyword search | ✅ Live | `GET /memory/search` — PostgreSQL `tsvector` search over memory key/value with `websearch_to_tsquery` relevance ranking |
| Knowledge Wiki | ✅ Live (v0.35) | Hierarchical spaces+pages, ACL groups, metadata fields, version history, hybrid search, PDF/Markdown ingest, agent RAG |
| STT (voice input) | ✅ Live | faster-whisper-server integration in chat UI |
| TTS (voice output) | ✅ Live | Browser Web Speech API |

### Channels
| Feature | Status | Notes |
|---------|--------|-------|
| Web chat UI | ✅ Live | Full streaming chat with tool call display |
| Telegram bot | ✅ Live | Commands, inline keyboards, agent loop, history; allowed user IDs managed as chip list in System Settings |
| Discord bot | ✅ Live (v0.36.0) | Full discord.py bot — @mention + DM support, /link account pairing, slash commands, voice transcription, per-server channel→agent routing, role-based access, thread mode, emoji reactions, admin UI |
| Playground | ✅ Live | Web-based single-turn agent playground |
| Email (AgentMail) | ✅ Live | Agents can create inboxes, send/receive email, manage threads via 9 built-in tools; admin inbox management UI |

### Infrastructure
| Feature | Status | Notes |
|---------|--------|-------|
| PostgreSQL | ✅ Live | Primary data store, Alembic migrations |
| Qdrant | ✅ Live | Vector store for semantic memory |
| DragonflyDB | ✅ Live | Redis-compatible pub/sub, Arq worker queues |
| SearXNG | ✅ Live | Private web search backend |
| Background workers (Arq) | ✅ Live | Async job execution |
| Self-hosted first | ✅ Live | No cloud lock-in |

---

## Competitive Analysis

### Competitors Reviewed

**OpenClaw** ([github.com/openclaw/openclaw](https://github.com/openclaw/openclaw))
- Personal/single-user focus, local-first, Node.js/TypeScript
- Strength: 20+ messaging channel integrations, Live Canvas A2UI, companion apps (macOS/iOS/Android), Docker/SSH sandboxing, ClawHub skill marketplace, cron/webhook automation

**Hermes-Agent** ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent))
- Self-improving research agent by Nous Research, Python
- Strength: MCP protocol support, closed learning loop with skill self-improvement, Honcho user modeling, FTS5 session search, 7 sandbox backends (Modal/Daytona/Vercel), Rich TUI, batch trajectory generation for fine-tuning

**ZeroClaw** ([github.com/zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw))
- Single-user, local-first Rust binary (Rust Edition 2024) — runs entirely on your machine, configured via a single TOML file
- Strength: 30+ channel adapters (Discord, Telegram, Matrix, Slack, Signal, WhatsApp, IRC, Mattermost, Lark/DingTalk, email, voice/telephony, social feeds, webhooks, CLI, ACP for IDE integration), ~20 LLM providers with automatic fallback chains, OS-level sandboxing (Landlock/Bubblewrap/Seatbelt/Docker), cryptographic tool receipts on every action, hardware I/O (GPIO/I2C/SPI/USB on Raspberry Pi/Arduino/ESP32), SOP engine (event-triggered workflows via MQTT/webhook/cron with approval gates and resumable runs), web gateway + dashboard
- Not multi-user — designed as a personal tool; no RBAC, no per-user isolation, no admin governance

**memUBot** ([github.com/NevaMind-AI/memUBot](https://github.com/NevaMind-AI/memUBot))
- Enterprise-ready team AI assistant built on the [memU](https://github.com/NevaMind-AI/memU) open-source memory framework; positions as "OpenClaw for your whole team"
- Strength: Advanced memory architecture (semantic indexing, auto-flush before compaction, shared memory pools, full memory audit trail, GDPR deletion), 4 live channels (Telegram, Discord, Slack, Feishu), MCP support, proactive 24/7 intent capture, one-click install < 3 min, ~10× token reduction via memory-optimized context selection
- Gaps: RBAC/SSO/multi-user on roadmap only, no web dashboard yet, macOS+Windows only (Linux planned), most enterprise governance features not yet built

---

### Where Conflux Leads
- **Only true multi-user platform** — RBAC, SSO, per-user isolation, tenant scoping (OpenClaw and ZeroClaw are single-user; memUBot's RBAC/SSO is roadmap-only)
- **Admin-governed AI** — skill approval workflow, provider assignment policies, usage governance
- **Agent colony/hive** — multi-agent orchestration with worker topology
- **Approval-gated learning** — skill evolution requires human sign-off before deployment
- **Enterprise-ready now** — PostgreSQL, audit trails, role management, API keys, system backup — all live today while memUBot still builds these features
- **First-class Discord bot** — full discord.py integration running the same AgentLoop as the web UI (not just a webhook relay); per-server routing, role ACL, thread mode, voice transcription
- **vs ZeroClaw specifically** — ZeroClaw wins on breadth of channel adapters and hardware I/O; Conflux wins on everything multi-user: RBAC, governance, web admin, per-user isolation, and the self-learning pipeline
- **vs memUBot specifically** — memUBot leads on memory architecture depth (auto-flush, shared pools, semantic recall); Conflux leads on live enterprise features (RBAC, SSO, full web dashboard, multi-agent, skill governance, backup/restore) — all of which memUBot has only on its roadmap

---

### Feature Gaps

#### Channels (ZeroClaw leads with 30+ adapters; memUBot comparable to Conflux)
| Channel | OpenClaw | Hermes | ZeroClaw | memUBot | Conflux |
|---------|---------|--------|----------|---------|---------|
| Telegram | ✅ | ❌ | ✅ | ✅ | ✅ |
| Discord | ✅ | ✅ | ✅ | ✅ | ✅ Live (v0.36.0) |
| Slack | ✅ | ✅ | ✅ | ✅ | ❌ |
| WhatsApp | ✅ | ❌ | ✅ | 🔜 Roadmap | ❌ |
| Email | ✅ | ✅ | ✅ | 🔜 Roadmap | ✅ Live (v0.33) |
| Signal | ✅ | ❌ | ✅ | ❌ | ❌ |
| Matrix | ✅ | ❌ | ✅ | ❌ | ❌ |
| IRC | ✅ | ❌ | ✅ | ❌ | ❌ |
| Mattermost | ❌ | ❌ | ✅ | ❌ | ❌ |
| Feishu / Lark | ❌ | ❌ | ✅ | ✅ | ❌ |
| Microsoft Teams | ✅ | ❌ | ❌ | ❌ | ❌ |
| Social (Bluesky/Twitter/Reddit) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Voice / Telephony | ❌ | ❌ | ✅ | ❌ | ❌ |
| Inbound Webhooks | ✅ | ❌ | ✅ | ❌ | ❌ |
| Web UI / Chat | ✅ | ❌ | ✅ | 🔜 Roadmap | ✅ |
| CLI | ✅ | ✅ | ✅ | 🔜 Roadmap | ✅ |

#### Tools & Execution
| Feature | OpenClaw | Hermes | ZeroClaw | memUBot | Conflux |
|---------|---------|--------|----------|---------|---------|
| MCP Protocol | ❌ | ✅ | ✅ | ✅ | ✅ Live (v0.27) |
| Tool sandboxing (Docker) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Tool sandboxing (SSH) | ✅ | ✅ | ❓ | ❌ | ❌ |
| OS-level sandbox (Landlock/Bubblewrap) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Serverless sandbox (Modal/Daytona) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Model failover/rotation | ✅ | partial | ✅ | ❓ | ❌ |
| Cron / scheduled tasks | ✅ | ✅ | ✅ | ✅ | ✅ Live (v0.28) |
| Hardware I/O (GPIO/SPI/I2C) | ❌ | ❌ | ✅ | ❌ | ❌ |

#### Intelligence & Memory
| Feature | OpenClaw | Hermes | ZeroClaw | memUBot | Conflux | Notes |
|---------|---------|--------|----------|---------|---------|-------|
| User persona modeling (SOUL) | partial | ✅ Honcho | ❓ | ✅ | ✅ Live | SOUL.md, AGENTS.md, identity_md, user_md, tools_md — injected into every agent run; editable in Settings |
| Context files (AGENTS.md) | ✅ | ✅ | ❓ | ❓ | ✅ Live | Per-user `agents_md` field in `UserPersonaFiles`, injected via `_fetch_persona_block()` in agent loop |
| Session FTS search | ❌ | ✅ | ❓ | ❓ | ✅ Live | PostgreSQL `tsvector` GIN index on runs + memory; `websearch_to_tsquery`; search bar in Runs dashboard |
| Trajectory collection for fine-tuning | ❌ | ✅ | ❓ | ❓ | ✅ Live | Admin-reviewed trajectory capture with OpenAI JSONL export |
| Session compression | ✅ | ✅ | ❓ | ✅ | ✅ Live | Summary is stored on runs and reused for future turns to reduce context cost |
| Long-term memory | Markdown files | ✅ | SQLite + embeddings | ✅ memU (semantic, auto-flush, shared pools) | ✅ Qdrant | memUBot has most advanced memory architecture |
| Memory audit trail | ❌ | ❌ | ❓ | ✅ | ❓ | memUBot provides exportable memory history |
| Knowledge Wiki | ✅ | ❌ | ❌ | ❌ | ✅ Live (v0.35) | Hierarchical spaces+pages, ACL groups, metadata fields, version history, hybrid search, agent RAG |

#### UX / Commands
| Feature | OpenClaw | Hermes | ZeroClaw | memUBot | Conflux |
|---------|---------|--------|----------|---------|---------|
| /compress | ✅ | ✅ | ❓ | ❓ | ✅ Live |
| /retry, /undo | ✅ | ✅ | ❓ | ❓ | ✅ Live (v0.34) |
| /personality | ✅ | ❌ | ❓ | ❓ | ✅ Live (v0.34) |
| /insights analytics | ✅ | ✅ | ❓ | 🔜 Roadmap | ✅ Live (v0.34) |
| /doctor diagnostic | ✅ | ✅ | ❓ | ❓ | ✅ Live (v0.34) |
| Rich TUI | ❌ | ✅ | ❓ | ❌ | ✅ Live (v0.29) |
| Onboarding wizard | ✅ | ❌ | ✅ (`zeroclaw onboard`) | ✅ (< 3 min) | ✅ Live (v0.34) |
| SOP / Workflow engine | ❌ | ❌ | ✅ (event-triggered, approval-gated) | ❌ | ❌ |

---

## Prioritized Build Roadmap

### Tier 1 — Critical (highest competitive impact)

#### T1-1: MCP (Model Context Protocol) Integration ✅ Shipped (v0.27)
**Delivered:**
- MCP client library (`conflux/integrations/mcp.py`) supporting stdio and SSE transports
- Bridge exposes MCP tools into Conflux's `ToolRegistry` dynamically
- Admin UI: add/configure/remove MCP servers per agent or globally
- Per-agent MCP server lists — different agents get different tool access
- Only admins can add MCP servers; tool-level risk is set by admin

---

#### T1-2: Cron / Scheduled Tasks ✅ Shipped (v0.28)
**Delivered:**
- Schedule model in DB: `agent_id`, `schedule` (cron expression), `input_template`, `channel`, `user_id`
- Natural-language → cron expression parser (e.g. "every weekday at 9am EST")
- Arq background worker polls due schedules and spawns agent runs
- Output delivered back to originating channel (Telegram, Discord, email, etc.)
- Admin UI: view/create/edit/delete schedules; user UI: manage own schedules

---

#### T1-3: Discord Channel ✅ Shipped (v0.36.0)
**Full discord.py bot** — not just a webhook relay. Messages run through the same AgentLoop as the web UI.

**Delivered:**
- `conflux/channels/discord_bot.py` — ConfluxBot with full AgentLoop integration
- `/link <api_key>` pairing flow → `DiscordLink` table
- Slash commands: `/ask`, `/link`, `/unlink`, `/new`, `/me`, `/agents`, `/status`, `/config` group
- Per-server channel→agent routing, role-based access control
- Thread-per-conversation mode, voice/audio transcription via faster-whisper-server
- Message reactions: ⏳ on receipt → ✅ on success / ❌ on error
- Proactive notification helper (`send_notification()`) for scheduler/run hooks
- Admin UI: Discord Bot page under Admin → Integrations (status, guild list, per-guild config editor)
- Graceful privileged intents fallback (runs without Members intent if not enabled in portal)

---

#### T1-4: Tool Sandboxing (Docker Backend)
**Why:** Critical for multi-user safety. Without sandboxing, shell tool execution by one user can affect another's workspace. OpenClaw and Hermes both sandbox.

**Scope:**
- Docker backend for `shell` tool: each execution spawns a container with resource limits
- Per-agent config: sandbox enabled/disabled, Docker image, CPU/memory limits, timeout
- Container cleanup on completion or timeout
- Filesystem isolation: agent gets a per-run `/workspace` volume, nothing else
- Admin UI: configure sandbox policy per agent

**Files:** `conflux/sandbox/docker_backend.py`, `conflux/tools/builtins/shell.py` update, agent config, admin UI

---

#### T1-5: Model Failover / Rotation
**Why:** Production reliability. If primary model is down or rate-limited, agent should automatically try the next provider.

**Scope:**
- Per-agent ordered fallback list: `[primary_provider, fallback_1, fallback_2]`
- Auto-failover on HTTP 429, 500, 503, or timeout
- Configurable retry policy: max retries, exponential backoff
- Log which fallback was used in run events
- Admin UI: drag-to-reorder fallback chain per agent

**Files:** `conflux/providers/failover.py`, agent config model, admin UI

---

### Tier 2 — High Value

#### T2-1: Slack Channel
- Slack Bolt SDK, same architecture as Discord
- Event subscriptions: `message.im`, `message.channels`, slash commands
- `/link <api_key>` pairing flow
- `conflux/channels/slack.py`

#### T2-2: Inbound Webhooks ✅ Shipped (v0.31)
- Generic `POST /v1/webhooks/{webhook_id}` endpoint
- Configurable per-agent: secret token, input field mapping, response delivery method
- Use cases: GitHub push events, form submissions, monitoring alerts, CI/CD triggers

#### T2-3: Session FTS Search ✅ Already Shipped
- PostgreSQL `tsvector` generated columns + GIN indexes on run `input`/`output` and memory key/value
- `GET /memory/search` and `GET /runs/search` use `websearch_to_tsquery` with relevance ranking
- Runs dashboard now includes a debounced search bar for indexed run history
- Complements existing Qdrant vector search (FTS = keyword, Qdrant = semantic)

#### T2-4: Context Files ✅ Already Shipped
Per-user `UserPersonaFiles` with `agents_md`, `soul_md`, `identity_md`, `user_md`, `tools_md`. Injected via `_fetch_persona_block()` in agent loop. Editable in Settings → Persona tab.

#### T2-5: User Persona Modeling ✅ Already Shipped
`UserPersonaFiles` model per user with SOUL.md tone/personality, AGENTS.md operating instructions, identity, user context, and tools context. Reflection pipeline can extract signals. Settings UI exposes all tabs.

---

### Tier 3 — Differentiation Features

#### T3-1: Session Compression (`/compress`) ✅ Shipped (v0.34)
- Summarizes conversation history when context gets long
- `/compress` command available in all channels + keyboard shortcut in web UI
- Stores compressed summary + raw history; subsequent turns use compressed context
- Reduces token cost for long sessions

#### T3-2: Conversation Commands (`/retry`, `/undo`, `/personality`) ✅ Shipped (v0.34)
- `/retry` — re-run last agent turn with same input (useful when output was poor)
- `/undo` — remove last exchange from history
- `/personality <name>` — switch agent system prompt persona on the fly
- Available in Telegram, Discord, and web UI

#### T3-3: Email Channel ✅ Shipped (v0.33 — AgentMail)
- Agents can create inboxes, send/receive email, and manage threads via 9 built-in tools
- Sender authentication: email address → Conflux user mapping
- Admin inbox management UI

#### T3-4: Trajectory Collection for Fine-Tuning ✅ Shipped
- Records high-quality agent runs as structured `(system, user, tool_calls, output)` trajectories
- Admin review UI: rate, tag, and approve trajectories
- Export in OpenAI and Anthropic fine-tuning JSONL format
- Conflux's multi-user platform provides richer, more diverse training data than any single-user tool

#### T3-5: `/insights` Usage Analytics ✅ Shipped (v0.34)
- Per-user and per-agent metrics: token usage, run counts, skill invocations, tool use frequency
- Time-series charts on dashboard
- `/insights` command in messaging channels returns a text summary
- Admin view: aggregate across all users, cost tracking per provider

#### T3-6: `/doctor` Diagnostic Command ✅ Shipped (v0.34)
- Health check for all services: PostgreSQL, Qdrant, DragonflyDB, SearXNG, LLM providers
- Reports latency, connection status, last successful heartbeat
- Available as `/doctor` in all channels and a dedicated admin dashboard page

---

## Implementation Notes

### MCP Integration Architecture
```
Admin adds MCP server (name, command/url, transport: stdio|sse)
       ↓
conflux/integrations/mcp.py connects on agent start
       ↓
Tools listed via tools/list → registered in ToolRegistry as mcp_<name>_<tool>
       ↓
Agent loop calls tool → MCP bridge proxies to MCP server → returns result
```

### Cron Architecture
```
User creates schedule (natural language or cron expression)
       ↓
Stored in DB: agent_id, cron_expr, input_template, channel_config, next_run_at
       ↓
Arq worker: every minute, check schedules with next_run_at <= now()
       ↓
Spawn agent run with input_template → deliver output to channel
       ↓
Update next_run_at = cron_next(cron_expr, now())
```

### Channel Architecture Pattern
All channels follow the same pattern established by Telegram:
1. Start bot/listener process managed by the channel manager
2. User pairs via `/link <api_key>` → stored in `channel_session` table
3. Incoming message → look up user by channel+chat_id → call agent loop
4. Agent loop output → format for channel (Telegram MarkdownV2, Discord Markdown, etc.) → send

---

## Version Targets

| Version | Status | Features |
|---------|--------|----------|
| v0.27 | ✅ Shipped | MCP Integration |
| v0.28 | ✅ Shipped | Cron / Scheduled Tasks |
| v0.29 | ✅ Shipped | Rich TUI |
| v0.30 | Planned | Slack Channel |
| v0.30 | Planned | Tool Sandboxing + Model Failover |
| v0.31 | ✅ Shipped | Inbound Webhooks + Session FTS |
| v0.32 | Planned | User Persona + Context Files |
| v0.33 | ✅ Shipped | AgentMail integration (Email channel) |
| v0.34 | ✅ Shipped | /doctor, /insights, /personality, /retry, /undo, Onboarding wizard |
| v0.35 | ✅ Shipped | Knowledge Wiki |
| v0.35.3 | ✅ Shipped | System Settings (DB-backed runtime config) |
| v0.35.4 | ✅ Shipped | System Settings polish (list-type chip input) |
| v0.35.5 | ✅ Shipped | Raw Trace Report (request audit log) |
| v0.35.6 | ✅ Shipped | Agent Audit Trail — tool calls, shell commands, errors |
| v0.35.7 | ✅ Shipped | Automated Skill Improvement Pipeline |
| v0.35.17 | ✅ Shipped | Full System Backup & Restore (PostgreSQL + Qdrant ZIP) |
| v0.36.0 | ✅ Shipped | Full Discord Bot Integration |
| v0.36.1 | ✅ Shipped | Discord Bot Bug Fixes (API key hash, Agent field refs, DB defaults, emoji reactions) |
| v0.37 | Planned | Tool Sandboxing + Model Failover |
| v1.0  | Planned | Full competitive parity + enterprise GA |

### Knowledge Wiki v0.35
- Hierarchical spaces and pages with ACL groups, hybrid search, PDF/Markdown ingest, and agent RAG.
- Per-page metadata fields: sources, external links, internal links, and tags.
- Version history panel for browsing and previewing past page revisions.
- Share button copies the current wiki page URL, and pages now show last edited by attribution.

### System Settings v0.35.3
- 21 runtime-configurable settings stored in `system_settings` DB table; `.env` values are read-only fallbacks.
- 7 categories: core (public_base_url), embeddings (5), search (2), voice (2), messaging (6), features (2), integrations (3).
- `SettingsService` applies a 60 s TTL in-memory cache; writes immediately mutate the live `Settings` singleton so all services pick up changes without restart.
- Admin UI at `/admin/settings` — per-setting inline edit, DB override badge, sensitive field masking, reset-to-env button, and chip tag input for list-type settings (e.g., Telegram Allowed User IDs).

### Request Trace Log v0.35.5
- `RequestTraceMiddleware` (Starlette `BaseHTTPMiddleware`) intercepts every request, captures method/path/status/duration/user/body, and fire-and-forgets a DB insert via `get_db_session()`.
- `request_traces` table (migration `0021`) — indexed on `created_at DESC` and `(user_email, created_at)`.
- Health/docs paths (`/docs`, `/redoc`, `/openapi.json`, `/health`) are skipped; auth paths have body redacted.
- Admin UI at `/admin/traces` — data table with colored method/status badges, inline expandable detail panel, filters for method/path/status/user/date, pagination.

## Agent Audit Trail v0.35.6

All agent tool calls are automatically captured via a hook in `ToolRegistry.execute()`:
- **Event types**: `tool_call` (generic), `shell_command` (shell_exec tool), `error` (exception or returncode != 0)
- **Captured fields**: tool name, args preview (1500 char limit), result preview (1500 char limit), error message, duration, agent run ID, user ID, session ID
- **Admin UI**: `/admin/audit` — filterable table with row expansion, summary cards, auto-refresh
- **API**: `GET /v1/admin/audit` with filters: event_type, tool_name, agent_run_id, user_id, since, until

## Skill Improvement Pipeline v0.35.7

A fully automated, background skill improvement system built on top of the existing reflection and evolution infrastructure:

### Pattern Detection (`conflux/learning/pattern_detector.py`)
Mines TraceEvent records (14-day window) for:
- **retry_loop**: same tool called 3+ times in a single run
- **user_correction**: runs with correction trace events where `by_user=True`
- **partial_failure**: completed runs that contain error trace events
- **repeated_workaround**: same >2-tool sequence appearing in 3+ different runs
- **low_confidence**: completions containing uncertainty markers
- **tool_failure**: tool_result events containing `"error"` key
- **repeated_error**: same error message across 3+ runs

### Per-Skill Background Evaluation (`conflux/learning/skill_evaluator.py`)
After every agent run that used skills, silently:
1. Assesses each skill's contribution using the LLM
2. Records dimensions improved, negative effects, evidence strength, counterfactual impact
3. Stores a `SkillEvalRecord` — never visible to users, never delays response
4. If recommendation is "update" and evidence_strength ≥ 0.7, creates an `ImprovementPattern`

### Candidate Lifecycle
`ImprovementPattern` → LLM generates `EvolutionCandidate` → scored on 8 dimensions against `EvalCase` records → **Promote** (auto-activates new skill version) / **Reject** / **Quarantine** (isolated for human review)

### New DB tables: `improvement_patterns`, `eval_cases`, `skill_eval_records`
### Extended table: `evolution_candidates` (decision, comparison_scores, test_results, pattern_id)

---

## Docker Containerization v0.35.8

Full Docker deployment stack — all services in a single `docker-compose.yml`:

### Application Containers
- **conflux-api**: FastAPI backend (`python:3.12-slim` + `uv`). Runs `alembic upgrade head` at startup, then starts uvicorn.
- **conflux-worker**: arq background worker sharing the same image as the API.
- **conflux-ui**: Multi-stage build — Bun builder compiles Next.js standalone output → Node.js 20 runner.

### Infrastructure Containers (all in compose)
- **db** — PostgreSQL 18 with named volume
- **dragonfly** — DragonflyDB (Redis-compatible, `cluster_mode=emulated`)
- **qdrant** — Qdrant vector store (HTTP 6333, gRPC 6334)
- **searxng** — SearXNG web search (config mounted from `./searxng-config/`)
- **valkey** — Valkey 9 (SearXNG session sidecar, internal only)
- **whisper** — faster-whisper CPU inference server

### Startup Order
`db` → `dragonfly` → `qdrant` (health checks) → `conflux-api` (migrations + health check) → `conflux-worker` + `conflux-ui`

### Files Added
- `Dockerfile` — shared API + worker image
- `Dockerfile.ui` — multi-stage UI build
- `docker-compose.yml` — all 9 services with health checks, named volumes, and service-name URL overrides
- `.env.docker.example` — root env template (service names, not 192.1.3.41)
- `ui/.env.docker.example` — UI NextAuth + provider env template
- `searxng-config/settings.yml` — minimal SearXNG config with Valkey backend
- `.dockerignore` — lean image exclusions

### `next.config.ts` change
Added `output: "standalone"` — required for the Node.js Docker runner to find `server.js`.

---
