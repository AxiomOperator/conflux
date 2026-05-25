export type ChangeCategory =
  | "feature"
  | "improvement"
  | "added"
  | "changed"
  | "fixed"
  | "removed";

export interface ChangeEntry {
  category: ChangeCategory;
  description: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  title?: string;
  items?: string[];
  summary: string;
  entries: ChangeEntry[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "0.35.12",
    date: "2026-05-25",
    title: "Provider Edit 500 Fix",
    summary: "Fixed PATCH /v1/providers 500 error by routing provider edits through the Next.js proxy (internal secret auth) instead of directly to FastAPI with the Azure AD Bearer token.",
    entries: [
      {
        category: "fixed",
        description: "Provider edit dialog now routes PATCH through /api/providers/[id] proxy route, eliminating the Azure AD JWT validation 500 error",
      },
      {
        category: "improvement",
        description: "FastAPI update_provider route now includes try/except with explicit db.flush() and structured error logging",
      },
    ],
  },
  {
    version: "0.35.11",
    date: "2026-05-25",
    title: "Provider Edit & Delete",
    summary: "Providers can now be edited (base URL, API key, enabled toggle) and deleted directly from the Providers page.",
    entries: [
      {
        category: "feature",
        description: "Edit button on each provider card opens a dialog to update base URL, API key, and enabled status",
      },
      {
        category: "feature",
        description: "PATCH /api/providers/[id] Next.js proxy route and PATCH /v1/providers/{id} FastAPI backend already supported; now fully wired to the UI",
      },
      {
        category: "improvement",
        description: "Delete button relocated next to Edit button for consistent action grouping per provider card",
      },
    ],
  },
  {
    version: "0.35.10",
    date: "2026-05-25",
    title: "Structured Error Handling",
    summary:
      "All unhandled exceptions now return structured JSON with a meaningful message instead of a bare 500.",
    entries: [
      {
        category: "feature",
        description:
          "Global FastAPI exception handler: catches all unhandled errors, logs them with full traceback, returns {detail, error} JSON",
      },
      {
        category: "fixed",
        description:
          "GET /providers/{id}/registered-models: wrapped in try/except with 404 provider check and structured 500 on DB errors",
      },
      {
        category: "fixed",
        description:
          "POST /providers/{id}/models: catches IntegrityError on duplicate model_name and returns 409 Conflict with a clear message",
      },
      {
        category: "fixed",
        description:
          "Providers UI: load-models errors are now surfaced to the user instead of silently ignored",
      },
    ],
  },
  {
    version: "0.35.9",
    date: "2026-05-25",
    title: "First-User Admin Bootstrap",
    summary:
      "The first user to sign up — via SSO or local credentials — is automatically promoted to admin.",
    entries: [
      {
        category: "feature",
        description:
          "First user created (SSO or credentials) is automatically made admin — no manual bootstrap needed",
      },
      {
        category: "changed",
        description:
          "POST /admin/sso/users is open (no auth required) when the user table is empty, enabling first-run setup",
      },
    ],
  },
  {
    version: "0.35.8",
    date: "2026-05-25",
    title: "Full Docker Deployment Stack",
    items: [
      "Single docker-compose.yml with all 9 services: Postgres, DragonflyDB, Qdrant, SearXNG, Valkey, faster-whisper, API, worker, and UI",
      "conflux-api runs Alembic migrations at container startup before serving",
      "conflux-ui multi-stage build: Bun compiles Next.js standalone → Node.js 20 runner",
      "Startup ordering enforced by healthchecks: infra → API → worker + UI",
      "Minimal SearXNG config included (searxng-config/settings.yml)",
      ".env.docker.example and ui/.env.docker.example templates for easy setup",
    ],
    summary:
      "One docker-compose up deploys the full Conflux stack — all infrastructure and application services with proper dependency ordering.",
    entries: [
      {
        category: "added",
        description:
          "docker-compose.yml with all 9 services: Postgres, DragonflyDB, Qdrant, SearXNG, Valkey, faster-whisper, API, worker, UI",
      },
      {
        category: "added",
        description:
          "Dockerfile for API + worker (Python 3.12 + uv, runs alembic migrations on startup)",
      },
      {
        category: "added",
        description:
          "Dockerfile.ui: multi-stage Bun builder → Node.js 20 runner with Next.js standalone output",
      },
      {
        category: "added",
        description:
          "searxng-config/settings.yml, .env.docker.example, and ui/.env.docker.example deployment templates",
      },
      {
        category: "changed",
        description:
          "next.config.ts: added output: standalone required for Docker Node.js runner",
      },
    ],
  },
  {
    version: "0.35.7",
    date: "2026-05-25",
    title: "Automated Skill Improvement Pipeline",
    items: [
      "Multi-signal pattern detection across run history: retry loops, user corrections, partial failures, repeated workarounds, low-confidence outputs, tool failures",
      "Background per-skill evaluation loop: silently assesses skill contribution after every run without interrupting the user",
      "Candidate scoring on 8 dimensions: accuracy, task completion, failure reduction, reliability, tool correctness, output quality, regression risk, overall",
      "Automated Promote/Reject/Quarantine decisions with full evidence records",
      "Evaluation case management for regression-testing candidate improvements before adoption",
      "Admin Improvement Pipeline page: Patterns, Candidates, Skill Evaluations, and Eval Cases tabs",
    ],
    summary:
      "Automated Skill Improvement Pipeline — multi-signal pattern detection, silent per-skill evaluation, scored candidates, and Promote/Reject/Quarantine decisions.",
    entries: [
      {
        category: "feature",
        description:
          "Multi-signal pattern detection across run history: retry loops, user corrections, partial failures, repeated workarounds, low-confidence outputs, tool failures",
      },
      {
        category: "feature",
        description:
          "Background per-skill evaluation loop: silently assesses skill contribution after every run without interrupting the user",
      },
      {
        category: "feature",
        description:
          "Candidate scoring on 8 dimensions: accuracy, task completion, failure reduction, reliability, tool correctness, output quality, regression risk, overall",
      },
      {
        category: "feature",
        description:
          "Automated Promote/Reject/Quarantine decisions with full evidence records",
      },
      {
        category: "feature",
        description:
          "Evaluation case management for regression-testing candidate improvements before adoption",
      },
      {
        category: "feature",
        description:
          "Admin Improvement Pipeline page: Patterns, Candidates, Skill Evaluations, and Eval Cases tabs",
      },
    ],
  },
  // ── 0.35.x — Knowledge Wiki & Admin Tools ────────────────────────────────
  {
    version: "0.35.6",
    date: "2026-05-25",
    title: "Agent Audit Trail",
    items: [
      "Full audit trail of every agent tool call with args previews, results, and timing",
      "Shell command audit captures stdout/stderr and exit codes",
      "Error events captured with full context for debugging agent failures",
      "Admin Audit Trail page with filters by event type, tool name, run ID, and date range",
    ],
    summary:
      "Agent Audit Trail — full audit trail of every agent tool call, shell output, errors, and timing details.",
    entries: [
      {
        category: "feature",
        description:
          "Full audit trail of every agent tool call with args previews, results, and timing",
      },
      {
        category: "feature",
        description:
          "Shell command audit captures stdout/stderr and exit codes",
      },
      {
        category: "feature",
        description:
          "Error events captured with full context for debugging agent failures",
      },
      {
        category: "feature",
        description:
          "Admin Audit Trail page with filters by event type, tool name, run ID, and date range",
      },
    ],
  },
  {
    version: "0.35.5",
    date: "2026-05-24",
    summary:
      "Raw Trace Report — every API call is now logged with method, path, status, duration, user, and full request/response body.",
    entries: [
      {
        category: "feature",
        description:
          "Request Trace Log — admin page showing every inbound API call with method, path, status code, duration, user email, remote IP, and body previews",
      },
      {
        category: "feature",
        description:
          "Trace detail panel — click any row to expand full request/response body, user agent, and IP address",
      },
      {
        category: "improvement",
        description:
          "Filterable by method, path, status code range, user email, and time window (today / 24h / 7d / custom)",
      },
    ],
  },
  {
    version: "0.35.4",
    date: "2026-05-24",
    summary:
      "System Settings polish — Telegram Allowed User IDs now uses a chip/tag list input.",
    entries: [
      {
        category: "improvement",
        description:
          "Telegram Allowed User IDs setting renders as a chip tag input — type an ID and press Enter/comma to add, click × to remove",
      },
      {
        category: "improvement",
        description:
          "List-type settings are stored as normalized comma-separated values and rendered as readable chips rather than a raw text field",
      },
    ],
  },
  {
    version: "0.35.3",
    date: "2026-05-24",
    summary:
      "System Settings — runtime configuration moved to database for zero-restart deploys.",
    entries: [
      {
        category: "feature",
        description:
          "System Settings admin page — override runtime config (embedding, search, voice, messaging, integrations) without restarting the server",
      },
      {
        category: "improvement",
        description:
          "21 settings across 7 categories (core, embeddings, search, voice, messaging, features, integrations) are now DB-configurable with .env as fallback",
      },
      {
        category: "improvement",
        description:
          "Settings changes take effect immediately — no server restart needed; DB overrides the live settings singleton in-place",
      },
    ],
  },
  {
    version: "0.35.2",
    date: "2026-05-24",
    summary:
      "View as User — admins can now preview exactly what regular users see, with a one-click toggle and visual indicator.",
    entries: [
      {
        category: "feature",
        description:
          "View as User toggle for admins — preview the UI as a regular user with wiki ACL and permissions fully enforced",
      },
      {
        category: "feature",
        description:
          "Amber banner displays when admin preview mode is active; one-click Exit Preview returns to admin view",
      },
      {
        category: "improvement",
        description:
          "Admin nav items and controls are hidden while in user-preview mode for an accurate non-admin experience",
      },
    ],
  },
  {
    version: "0.35.1",
    date: "2026-05-25",
    summary:
      "Knowledge Wiki polish — page metadata, revision browsing, sharing, attribution, and admin UX improvements.",
    entries: [
      {
        category: "feature",
        description:
          "Wiki article metadata: sources, external links, internal links, and tags fields on every page",
      },
      {
        category: "feature",
        description:
          "Wiki version history panel — browse and preview past page revisions",
      },
      {
        category: "feature",
        description:
          "Share button on wiki pages — one-click copy of page URL to clipboard",
      },
      {
        category: "feature",
        description: "Last edited by attribution on wiki pages",
      },
      {
        category: "improvement",
        description:
          "Wiki admin: Create Space and Create Group buttons now disabled until required name field is filled",
      },
      {
        category: "improvement",
        description:
          "Wiki admin: Icon field replaced with visual emoji picker (72 emojis, searchable, categorized)",
      },
    ],
  },
  {
    version: "0.35.0",
    date: "2026-05-24",
    summary:
      "Knowledge Wiki — full-featured wiki system with hierarchical spaces, access control groups, hybrid semantic+keyword search, and automatic agent RAG injection.",
    entries: [
      {
        category: "added",
        description:
          "Hierarchical wiki spaces and pages with nested tree structure.",
      },
      {
        category: "added",
        description:
          "Admin-defined access control groups with space-level and page-level ACL rules.",
      },
      {
        category: "added",
        description:
          "Hybrid search: Qdrant semantic search + PostgreSQL full-text search.",
      },
      {
        category: "added",
        description:
          "PDF and Markdown file upload → auto-chunk → embed for instant search.",
      },
      {
        category: "added",
        description: "Automatic wiki RAG injection into agent system prompts.",
      },
      {
        category: "added",
        description: "Per-agent wiki_rag_enabled toggle.",
      },
      {
        category: "added",
        description: "Markdown editor with live preview and version history.",
      },
      {
        category: "added",
        description:
          "Admin panel for groups, spaces, and access rules management.",
      },
    ],
  },
  // ── 0.34.x — UX Commands + Onboarding ─────────────────────────────────────
  {
    version: "0.34.0",
    date: "2026-05-28",
    summary:
      "/doctor, /insights, /personality, /retry, /undo — UX commands + onboarding wizard",
    entries: [
      {
        category: "added",
        description:
          "/doctor diagnostic command and admin diagnostics page — run live health checks for PostgreSQL, Qdrant, DragonflyDB/Redis, SearXNG, and configured LLM providers from chat or the admin console.",
      },
      {
        category: "added",
        description:
          "/insights analytics dashboard and chat command — personal run analytics for every user plus system-wide metrics for admins, including charts for 30-day usage, run status breakdowns, top agents, and a quick slash-command summary in chat.",
      },
      {
        category: "added",
        description:
          "/personality command — choose agent response style from 5 presets (concise, creative, technical, friendly, formal); persisted per-user, injected into system prompt.",
      },
      {
        category: "added",
        description:
          "/retry and /undo commands — retry the last AI response or undo the last exchange; available as slash commands and inline message buttons.",
      },
      {
        category: "added",
        description:
          "Onboarding wizard — guided 5-step first-run experience covering provider setup, agent creation, and first chat; auto-dismissed when tour is complete.",
      },
    ],
  },
  // ── 0.33.x — AgentMail Integration ────────────────────────────────────────
  {
    version: "0.33.0",
    date: "2026-05-28",
    summary: "AgentMail integration — give agents a real email address",
    entries: [
      {
        category: "added",
        description:
          "AgentMail integration: agents can now create inboxes, send and receive email, read threads, create drafts, and reply — via 9 new built-in agent tools (create_inbox, list_inboxes, send_message, list_messages, get_message, list_threads, get_thread, reply_to_thread, create_draft).",
      },
      {
        category: "added",
        description:
          "Admin panel: AgentMail page under /admin/agentmail — view connection status, create and manage inboxes, browse messages and threads per inbox.",
      },
      {
        category: "added",
        description:
          "Inbound webhook endpoint at /v1/admin/agentmail/webhook for receiving real-time message events from AgentMail.",
      },
    ],
  },
  // ── 0.32.x — Session Compression ──────────────────────────────────────────
  {
    version: "0.32.0",
    date: "2026-05-27",
    summary: "Session compression — summarize long chats to cut context cost",
    entries: [
      {
        category: "added",
        description:
          "Session compression for web chat and Telegram: compresses long conversation history into a reusable summary, stores it on runs, and injects that summary into future turns so sessions continue with fewer tokens.",
      },
      {
        category: "added",
        description:
          "New /compress command in Telegram plus a Compress button in the web chat UI once a session has 5+ messages, including a compressed-session indicator.",
      },
    ],
  },
  // ── 0.31.x — Session FTS Search ──────────────────────────────────────────
  {
    version: "0.31.0",
    date: "2026-05-27",
    summary:
      "Session full-text search — PostgreSQL-backed search across run history and memory",
    entries: [
      {
        category: "added",
        description:
          "Session full-text search: PostgreSQL tsvector GIN-indexed search over run history and memory, powered by websearch_to_tsquery ranking and a new Runs dashboard search bar.",
      },
    ],
  },
  // ── 0.30.x — Multi-Provider SSO ──────────────────────────────────────────
  {
    version: "0.30.0",
    date: "2026-05-26",
    summary:
      "Multi-Provider SSO — GitHub, Google, Generic OIDC, and email/password auth",
    entries: [
      {
        category: "added",
        description:
          "GitHub OAuth sign-in provider — admin-toggleable from the new SSO Providers admin page. Requires GITHUB_ID and GITHUB_SECRET env vars.",
      },
      {
        category: "added",
        description:
          "Google OAuth sign-in provider — admin-toggleable. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.",
      },
      {
        category: "added",
        description:
          "Generic OIDC provider — connects to any OpenID Connect provider (Okta, Keycloak, Auth0, etc.). Requires OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_ISSUER env vars. Display name configurable via OIDC_PROVIDER_NAME.",
      },
      {
        category: "added",
        description:
          "Credentials (email + password) provider — admin-only user creation, no self-registration. Users are stored with bcrypt-hashed passwords.",
      },
      {
        category: "added",
        description:
          "Admin SSO Providers page (/admin/sso) — toggle each provider on/off, see configuration status, and manage credentials users (create, delete).",
      },
      {
        category: "added",
        description:
          "Dynamic login page — shows only the providers that are both configured (env vars set) and enabled in admin settings. Falls back to a 'no methods available' message if none are active.",
      },
      {
        category: "added",
        description:
          "Agent ID shown inline in the agents table — monospace text under the agent name; click to copy to clipboard.",
      },
      {
        category: "added",
        description:
          "Trajectory collection for fine-tuning — completed agent runs are captured for admin review at /admin/trajectories, can be approved/rejected with quality scores, and exported as OpenAI JSONL.",
      },
      {
        category: "fixed",
        description:
          "Rich TUI dashboard no longer retries every 3 s on HTTP 401 — shows a dedicated 'Access Denied' panel with remediation steps and pauses for 1 hour.",
      },
    ],
  },
  // ── 0.29.x — Rich TUI ────────────────────────────────────────────────────
  {
    version: "0.29.0",
    date: "2026-05-24",
    summary: "Rich TUI — full-screen terminal interface powered by Rich v15",
    entries: [
      {
        category: "added",
        description:
          "conflux tui dashboard — full-screen live dashboard with Layout: header bar, 4 stat panels (runs/active/agents/memories), auto-refreshing runs table with status colours and relative timestamps. Refreshes every 3s.",
      },
      {
        category: "added",
        description:
          "conflux tui chat <agent_id> — interactive Rich chat interface with streaming token display via Live, Markdown rendering of agent responses (code blocks, headers, lists), tool-call panels, and full conversation history. --message flag for one-shot non-interactive use.",
      },
      {
        category: "added",
        description:
          "conflux tui monitor [run_id] — live run watcher: streams SSE output of a specific run with spinner, token buffer, tool-call panels, and final stats; or polls all active runs in a live-updating table.",
      },
      {
        category: "added",
        description:
          "conflux dashboard — top-level shortcut to launch the dashboard directly without the tui subcommand.",
      },
      {
        category: "changed",
        description:
          "conflux run task — streaming output now renders the complete response with rich.markdown.Markdown after streaming completes, so code blocks and formatting are displayed correctly.",
      },
      {
        category: "added",
        description:
          "TUI core module (conflux/cli/tui/): shared theme (CONFLUX_THEME), status colour map, make_client() factory, fmt_dt() relative-time formatter, truncate() helper.",
      },
    ],
  },
  // ── 0.28.x — Cron / Scheduled Tasks ─────────────────────────────────────
  {
    version: "0.28.0",
    date: "2026-05-24",
    summary:
      "Cron / Scheduled Tasks — automate any agent on a recurring schedule",
    entries: [
      {
        category: "added",
        description:
          "Natural-language → cron expression parser: 'every weekday at 9am EST' converts automatically to a UTC cron expression. Falls back to direct cron if a valid 5-field expression is given.",
      },
      {
        category: "added",
        description:
          "Scheduled Tasks DB model and migration (0008): stores cron expression, NL original, delivery channel, input template, next_run/last_run timestamps, and run count.",
      },
      {
        category: "added",
        description:
          "Background arq worker job tick_schedules polls every 5 minutes, spawns agent runs for due schedules, and updates next_run via croniter.",
      },
      {
        category: "added",
        description:
          "Full REST API at /v1/schedules: list, create, get, update, delete, and run-now. Users manage their own schedules; admins see all.",
      },
      {
        category: "added",
        description:
          "Schedules UI at /schedules: create/edit/delete schedules, toggle enabled, run-now button, next-run and last-run display.",
      },
      {
        category: "added",
        description:
          "Telegram delivery channel: scheduled run output is sent back to the originating Telegram chat when channel='telegram'.",
      },
    ],
  },
  // ── 0.27.x — MCP (Model Context Protocol) Integration ────────────────────
  {
    version: "0.27.0",
    date: "2026-05-24",
    summary:
      "MCP (Model Context Protocol) integration — connect any MCP server to any agent",
    entries: [
      {
        category: "added",
        description:
          "MCP client library supporting both stdio (subprocess) and SSE (HTTP) transports — agents can now connect to any MCP server from the 500+ ecosystem.",
      },
      {
        category: "added",
        description:
          "RunScopedRegistry: per-run tool registry that merges global Conflux tools with per-agent MCP tools. Concurrent runs are fully isolated.",
      },
      {
        category: "added",
        description:
          "MCP tool bridge: automatically registers discovered MCP tools into the agent loop as mcp__<server>__<tool>. Tool cleanup happens on run finalize.",
      },
      {
        category: "added",
        description:
          "Full REST API for MCP server management (CRUD, test connection, agent assignment) at /v1/mcp. Admin-only create/update/delete.",
      },
      {
        category: "added",
        description:
          "Admin UI: MCP Servers page at /admin/mcp — add, edit, delete, and test MCP servers with live tool discovery.",
      },
      {
        category: "added",
        description:
          "Agent edit UI: MCP panel to assign/unassign MCP servers per agent with a toggle switch.",
      },
      {
        category: "added",
        description:
          "Database schema: mcp_servers and agent_mcp_servers tables (migration 0007).",
      },
    ],
  },
  // ── 0.26.x — Infrastructure Status + Telegram Commands ───────────────────
  {
    version: "0.26.0",
    date: "2026-05-24",
    summary:
      "Infrastructure status dashboard, Telegram command menu, conversation history",
    entries: [
      {
        category: "added",
        description:
          "Dashboard now shows a live Infrastructure card that pings PostgreSQL, Qdrant, DragonflyDB, SearXNG, Whisper, and the Telegram bot — with latency and error details. Auto-refreshes every 60s.",
      },
      {
        category: "added",
        description:
          "Telegram bot command menu registered via setMyCommands on startup — users see a native autocomplete menu with all commands.",
      },
      {
        category: "added",
        description:
          "New Telegram commands: /me (account info), /agents (inline keyboard to switch agents), /new (clear conversation history), /cancel.",
      },
      {
        category: "added",
        description:
          "Telegram conversation history stored in DragonflyDB per user (40-message window, 7-day TTL). Agent now remembers the full conversation thread.",
      },
      {
        category: "fixed",
        description:
          "/status command now performs direct DB and DragonflyDB pings instead of a self-HTTP call that used the wrong port.",
      },
    ],
  },
  // ── 0.25.x — Telegram Agent Integration ──────────────────────────────────
  {
    version: "0.25.0",
    date: "2025-07-07",
    summary:
      "Telegram bot fully integrated — messages run through the same agent loop as the web UI",
    entries: [
      {
        category: "added",
        description:
          "Telegram users can now link their account to Conflux via /link <api_key>. The bot validates the API key and stores the pairing in the new telegram_links table.",
      },
      {
        category: "added",
        description:
          "Incoming Telegram messages are now processed by AgentLoop directly — the same execution path used by /v1/runs/{run_id}/stream. Runs are recorded in the DB with full event history.",
      },
      {
        category: "added",
        description:
          "/unlink command removes the Telegram-to-Conflux account pairing. /start and /help updated with link instructions.",
      },
      {
        category: "added",
        description:
          "Settings page API Keys section now shows a Telegram linking guide with the exact /link command to use.",
      },
      {
        category: "fixed",
        description:
          "Telegram bot now starts correctly in the FastAPI lifespan using PTB v20 async context manager pattern — previously it was never started.",
      },
    ],
  },
  // ── 0.24.x — Live Dashboard ──────────────────────────────────────────────
  {
    version: "0.24.2",
    date: "2025-07-07",
    summary:
      "SkillsMP marketplace integration — browse, search, and import community skills",
    entries: [
      {
        category: "added",
        description:
          "New Marketplace tab on the Skills page lets users search skillsmp.com directly from Conflux. Results show skill name, author, star count, and description.",
      },
      {
        category: "added",
        description:
          "Admins can import any marketplace skill into their local catalog with one click. Imported skills are added as drafts for review before agent use.",
      },
      {
        category: "added",
        description:
          "Backend marketplace proxy endpoints: GET /v1/skills/marketplace/search and POST /v1/skills/marketplace/import. Skill content is fetched directly from the source GitHub repository.",
      },
      {
        category: "added",
        description:
          "New search_skills_marketplace builtin tool — agents can now search the SkillsMP registry to discover reusable skills for their tasks.",
      },
    ],
  },
  {
    version: "0.24.1",
    date: "2025-07-07",
    summary:
      "Skills page fixes — manual creation, improved empty state, correct API response fields",
    entries: [
      {
        category: "added",
        description:
          "Admins can now manually create skills via a 'New Skill' button and dialog on the Skills page. Supports name, description, category, markdown content, global flag, and optional immediate approval.",
      },
      {
        category: "added",
        description:
          "Skills page now shows a rich empty state explaining how skills are auto-drafted by the reflection system, with a tip to run multi-tool agent tasks.",
      },
      {
        category: "fixed",
        description:
          "Skills API now returns approval_status, created_at, version, and category fields so the table renders correctly.",
      },
      {
        category: "fixed",
        description:
          "Reflection system now drafts skills more eagerly — any run with a meaningful workflow qualifies, not just runs with 5+ tool calls.",
      },
      {
        category: "fixed",
        description:
          "Skills table now shows a Category column alongside Version and Status.",
      },
    ],
  },
  {
    version: "0.24.0",
    date: "2025-07-07",
    summary:
      "Live Dashboard — activity feed, auto-refresh, provider health ping, and colony summary",
    entries: [
      {
        category: "added",
        description:
          "Dashboard now auto-refreshes every 30 seconds with a pulsing green indicator when runs are active. A manual Refresh button with loading spinner is also available.",
      },
      {
        category: "added",
        description:
          "Activity feed on the dashboard shows a unified timeline of recent runs, memories ingested, and reflection jobs — color-coded by event type.",
      },
      {
        category: "added",
        description:
          "Provider Health section on the dashboard lists every configured LLM provider with a Ping button that performs a live health check and updates status instantly.",
      },
      {
        category: "added",
        description:
          "Colony summary section shows agent roster with type, status, and run counts.",
      },
      {
        category: "added",
        description:
          "Backend GET /v1/admin/activity-feed endpoint returns last 20 unified events (runs with agent names, memories, reflection jobs) sorted by timestamp.",
      },
      {
        category: "changed",
        description:
          "Dashboard stat cards are now clickable links to their respective pages (agents, runs, memory, skills).",
      },
    ],
  },
  // ── 0.23.x — Learning page depth ────────────────────────────────────────
  {
    version: "0.23.0",
    date: "2026-05-23",
    summary:
      "Learning page depth — expandable reflection jobs, evolution diff view, and richer memory display",
    entries: [
      {
        category: "added",
        description:
          "Reflection job rows are now expandable: click any row to see every memory extracted and every skill drafted by the post-run reflection LLM.",
      },
      {
        category: "added",
        description:
          "Evolution diff modal: click 'Diff' on any evolution candidate to see a line-by-line diff of the current skill content vs the proposed improvement. Approve or reject directly from the modal.",
      },
      {
        category: "changed",
        description:
          "Memory timeline now shows axis labels (first, mid, last day) and a hover count tooltip so you can read exact values without guessing.",
      },
      {
        category: "changed",
        description:
          "Recent memories card now shows scope badge, timestamp, and full-length value (no line-clamp) with tag chips below each entry.",
      },
      {
        category: "changed",
        description:
          "Backend learning-metrics endpoint now includes full learned_memories and drafted_skills arrays on each reflection job, and current_content/proposed_content on evolution candidates.",
      },
    ],
  },
  // ── 0.22.x — STT + TTS in chat ─────────────────────────────────────────
  {
    version: "0.22.0",
    date: "2026-05-23",
    summary:
      "Voice I/O in chat — STT mic input via faster-whisper and TTS read-aloud via Microsoft Azure Neural Voices (edge-tts)",
    entries: [
      {
        category: "added",
        description:
          "STT mic button in chat input: tap to start recording, tap again to stop and transcribe via faster-whisper. Transcript is appended to the current input field.",
      },
      {
        category: "added",
        description:
          "TTS read-aloud via edge-tts (Microsoft Azure Neural Voices — Ava, Andrew, Emma, Brian and 8 more). Natural-sounding speech served as MP3 from a backend /v1/tts/speak endpoint.",
      },
      {
        category: "added",
        description:
          "Per-message speak button on assistant messages (hover to reveal). Auto-speak toggle in the input toolbar speaks every response automatically after streaming.",
      },
      {
        category: "added",
        description:
          "Voice selector in the chat input toolbar: choose from 12 high-quality English voices (US, UK, AU accents, male/female).",
      },
    ],
  },
  // ── 0.21.x — API key management ────────────────────────────────────────
  {
    version: "0.21.0",
    date: "2026-05-24",
    summary:
      "API key management — create, view, and revoke personal API keys from the Settings page",
    entries: [
      {
        category: "added",
        description:
          "API key management UI in Settings: create named keys with optional expiry, view all active keys with created/last-used dates, and revoke keys with a single click.",
      },
      {
        category: "added",
        description:
          "One-time key reveal on creation: the raw API key is displayed with a show/hide toggle and clipboard copy button immediately after creation and is never shown again.",
      },
      {
        category: "added",
        description:
          "GET /v1/users/me/api-keys, POST /v1/users/me/api-keys, DELETE /v1/users/me/api-keys/{key_id} convenience endpoints — no need to know your user UUID.",
      },
      {
        category: "added",
        description:
          "Inline API usage hint on the settings page shows the base URL and Authorization header format.",
      },
    ],
  },
  // ── 0.20.x — Run detail enhancements ───────────────────────────────────
  {
    version: "0.20.0",
    date: "2026-05-23",
    summary:
      "Run detail page redesign — token usage tracking, stored run events, tool call tree, iteration timeline, error cards, and copy buttons",
    entries: [
      {
        category: "added",
        description:
          "Token usage tracking: prompt, completion, and total token counts are now captured from every LLM call and stored on the run. Displayed as stat cards on the run detail page.",
      },
      {
        category: "added",
        description:
          "GET /v1/runs/{id}/events API endpoint: returns stored RunEvents (tool_call, tool_result, status, error) ordered by sequence. Previously these were only visible during live streaming.",
      },
      {
        category: "added",
        description:
          "Tool call tree on run detail: collapsible accordion pairing each tool_call with its matching tool_result. Works for both live runs (SSE events) and completed runs (stored events).",
      },
      {
        category: "added",
        description:
          "Iteration timeline: status checkpoints from the agent loop displayed as a vertical timeline with timestamps.",
      },
      {
        category: "added",
        description:
          "Error detail card: failed runs now surface the error message prominently in a red callout card.",
      },
      {
        category: "added",
        description:
          "Copy buttons on run input and output JSON cards for quick clipboard access.",
      },
      {
        category: "added",
        description:
          "Live elapsed timer: during active runs the Duration stat card counts up in real time from the run start.",
      },
      {
        category: "changed",
        description:
          "Run detail stat cards redesigned: Created / Elapsed (live) or Duration (completed) / Started, plus three token count cards when available.",
      },
    ],
  },
  // ── 0.19.x — Dark Mode ──────────────────────────────────────────────────
  {
    version: "0.19.0",
    date: "2026-05-23",
    summary:
      "Dark mode support via next-themes — toggle between light, dark, and system preference from the header",
    entries: [
      {
        category: "added",
        description:
          "Dark mode: full shadcn/ui dark theme support powered by next-themes. Defaults to system preference.",
      },
      {
        category: "added",
        description:
          "Mode toggle button in the top-right of the dashboard header — click to switch between Light, Dark, and System themes.",
      },
    ],
  },
  // ── 0.18.x — True Chat section ──────────────────────────────────────────
  {
    version: "0.18.0",
    date: "2026-05-23",
    summary:
      "Persistent Chat — thread-based conversation UI backed by the real Conflux agent loop with memory, tools, and persona injection",
    entries: [
      {
        category: "added",
        description:
          "Chat page (/chat): two-panel layout with a conversation thread list on the left and a streaming message view on the right. Supports creating, renaming, and deleting threads.",
      },
      {
        category: "added",
        description:
          "Persistent sessions: every conversation is stored in the database (sessions + messages tables) and loaded on demand. Full message history is sent as context on each run.",
      },
      {
        category: "added",
        description:
          "Real agent loop: chat routes through the Conflux orchestrator agent (POST /v1/runs + SSE stream) — not the Vercel AI SDK. Tools, memory, and all persona files are active in every chat message.",
      },
      {
        category: "added",
        description:
          "Auto-titling: threads are automatically named from the first user message. Titles can be edited inline in the session list.",
      },
      {
        category: "added",
        description:
          "Tool call cards: tool invocations and results are shown inline in the conversation with expandable detail views.",
      },
      {
        category: "added",
        description:
          "Backend API: GET/POST /v1/sessions, GET/PATCH/DELETE /v1/sessions/{id}, GET/POST /v1/sessions/{id}/messages for session and message management.",
      },
      {
        category: "added",
        description:
          "Chat nav item added to the sidebar under the main navigation group.",
      },
    ],
  },
  // ── 0.17.x — Per-user agent persona files ───────────────────────────────
  {
    version: "0.17.0",
    date: "2026-05-23",
    summary:
      "Per-user agent persona files — AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, BOOT.md editable in the UI and auto-injected into every agent session",
    entries: [
      {
        category: "added",
        description:
          "Per-user persona files: each user now has seven editable configuration documents (AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, BOOT.md) stored independently in the database.",
      },
      {
        category: "added",
        description:
          "Settings page: new /settings route with a tabbed markdown editor for all seven persona files — changes take effect on the next agent run.",
      },
      {
        category: "added",
        description:
          "Agent loop injection: persona files are automatically prepended to the system prompt on every run (order: IDENTITY → SOUL → AGENTS → USER → TOOLS), establishing identity and tone before the base system prompt.",
      },
      {
        category: "added",
        description:
          "Workspace provisioning: new users receive sensible default content for AGENTS.md, SOUL.md, USER.md, and IDENTITY.md automatically on first login.",
      },
      {
        category: "added",
        description:
          "Backend API: GET /v1/users/me/persona and PATCH /v1/users/me/persona endpoints for reading and partially updating persona files.",
      },
      {
        category: "added",
        description:
          "DB migration 0005: user_persona_files table with per-user unique constraint and TEXT columns for all seven files.",
      },
    ],
  },
  // ── 0.16.x — Per-user workspaces ────────────────────────────────────────
  {
    version: "0.16.0",
    date: "2026-05-22",
    summary:
      "Per-user workspaces — every user automatically gets a personal tenant, project, and orchestrator on first login",
    entries: [
      {
        category: "added",
        description:
          "Automatic workspace provisioning: on first login each user receives a personal Tenant, Project, and Orchestrator agent scoped to them.",
      },
      {
        category: "added",
        description:
          "Personal orchestrator: each user's orchestrator is seeded with a personalised system prompt enabling web search, memory, skills, and subagent spawning.",
      },
      {
        category: "added",
        description:
          "DB migration (0004): added personal_project_id / personal_tenant_id FK columns to users and owner_user_id to projects.",
      },
      {
        category: "added",
        description:
          "Enhanced /me endpoint: now returns workspace object with project_id, tenant_id, orchestrator_id, and orchestrator_name.",
      },
    ],
  },
  // ── 0.15.x — Admin tools management ────────────────────────────────────
  {
    version: "0.15.0",
    date: "2026-05-22",
    summary:
      "Admin tools management — view, configure, enable/disable, and add custom webhook tools",
    entries: [
      {
        category: "added",
        description:
          "New Tools section in the admin area: view all registered tools with risk badges, enable/disable toggles, parameter schema viewer, and full CRUD.",
      },
      {
        category: "added",
        description:
          "Built-in tool overrides: admins can override description, risk level, and approval requirements for any built-in tool without code changes.",
      },
      {
        category: "added",
        description:
          "Custom webhook tools: create HTTP-backed tools that agents can call. Conflux POSTs the tool arguments as JSON to your configured endpoint.",
      },
      {
        category: "added",
        description:
          "Tool configuration persisted to DB (tool_configs table). Changes take effect immediately without restart via live registry sync.",
      },
    ],
  },
  // ── 0.14.x — Subagent spawn & colony tools ──────────────────────────────
  {
    version: "0.14.0",
    date: "2026-05-22",
    summary:
      "Subagent spawning — orchestrators can now spawn workers and swarms",
    entries: [
      {
        category: "added",
        description:
          "New list_agents tool: agents can discover the colony — returns id, name, type, description, and tool allowlist for every enabled agent.",
      },
      {
        category: "added",
        description:
          "New spawn_agent tool: orchestrators can spawn a worker agent with a task and receive its result synchronously. Parent/child run linkage is recorded in the DB (parent_run_id).",
      },
      {
        category: "added",
        description:
          "New spawn_swarm tool: launch multiple worker agents in parallel in one call. All workers run concurrently; results are collected and returned together when all complete.",
      },
      {
        category: "changed",
        description:
          "Orchestrator agent tool allowlist updated to include list_agents, spawn_agent, and spawn_swarm.",
      },
      {
        category: "fixed",
        description:
          "Runs stuck in 'running' or 'queued' state after a process restart are now automatically reset to 'failed' on API startup.",
      },
    ],
  },
  // ── 0.13.x — Auth proxy fix, server-side internal auth ──────────────────
  {
    version: "0.13.0",
    date: "2026-05-22",
    summary:
      "Internal auth proxy — all browser and server-side API calls now work reliably",
    entries: [
      {
        category: "fixed",
        description:
          "Browser API calls were failing with 401 — fixed by setting NEXT_PUBLIC_API_URL to empty so the browser uses relative /v1/* URLs, proxied through Next.js rewrites to the backend.",
      },
      {
        category: "fixed",
        description:
          "All browser-originated API requests now use an internal shared secret (X-Internal-Secret + X-User-Email headers) injected by the Next.js middleware, eliminating reliance on short-lived Azure AD JWTs.",
      },
      {
        category: "fixed",
        description:
          "Server-side Next.js API routes (/api/runs, /api/runs/[id]/stream) were failing with 401 because they used expired Azure AD Bearer tokens — replaced with internal secret auth.",
      },
      {
        category: "fixed",
        description:
          "createServerApiClient() now uses the internal secret + session email instead of a JWT Bearer token, so SSR pages (Runs, Run detail, Agents) load correctly.",
      },
      {
        category: "fixed",
        description:
          "New Agent modal and Agents page were unclickable after navigation — resolved as part of the auth chain fix (401 on /v1/users/me was preventing canManage from resolving).",
      },
      {
        category: "changed",
        description:
          "Enable/disable toggle moved to the top-right corner of the Edit Agent modal header for quicker access without scrolling the form.",
      },
    ],
  },
  // ── 0.12.x — Agent editing, provider model management ───────────────────
  {
    version: "0.12.0",
    date: "2026-05-24",
    summary: "Agent editing + enable/disable, provider model registration",
    entries: [
      {
        category: "added",
        description:
          "Agent table now has per-row action buttons: Enable/Disable toggle (green Power icon), Edit (pencil), Copy ID, and Delete (trash).",
      },
      {
        category: "added",
        description:
          "Edit Agent modal — pre-filled with current name, description, system prompt, tool allowlist, and model policy. Includes inline enable/disable toggle switch.",
      },
      {
        category: "added",
        description:
          "Provider cards now include a 'Registered models' expandable section where admins can add or remove manually registered models (model name, display name, context length).",
      },
      {
        category: "added",
        description:
          "New backend endpoints: PATCH /agents/{id} (already existed, now wired to UI), POST /providers/{id}/registered-models, GET /providers/{id}/registered-models, DELETE /providers/{id}/models/{model_id}.",
      },
    ],
  },
  // ── 0.11.x — Agent model policy, memory search/delete, evolution approval ──
  {
    version: "0.11.0",
    date: "2026-05-24",
    summary:
      "Agent model policy editor, memory search + delete, evolution candidate approval",
    entries: [
      {
        category: "added",
        description:
          "Agent create modal now includes a Tool Allowlist picker — toggle individual tools (web_search, memory_read/write, http_fetch, skill_list/read/draft, shell_exec) with a visual toggle. Leave all unchecked to allow all tools.",
      },
      {
        category: "added",
        description:
          "Agent create modal now includes a Model Policy editor — add task-type → model-name mappings (e.g. coding → gpt-4o) via a dynamic key/value row editor.",
      },
      {
        category: "added",
        description:
          "Agent list table now shows a Tools column with badge pills for the tool allowlist.",
      },
      {
        category: "added",
        description:
          "Memory page now has a full-text search bar that queries across all scopes (user, session, global) in real time via the new /memory/search API endpoint.",
      },
      {
        category: "added",
        description:
          "Memory page now has per-row delete buttons — remove individual memory entries instantly without leaving the page.",
      },
      {
        category: "added",
        description:
          "Evolution Candidates table on the Learning page now shows Approve / Reject action buttons for pending candidates (admin only). Reject endpoint added to backend.",
      },
      {
        category: "added",
        description:
          "New GET /memory/search backend endpoint performs cross-scope fuzzy text search across content, key, and tags.",
      },
    ],
  },
  // ── 0.10.x — Colony hive UI + Voice STT ─────────────────────────────────
  {
    version: "0.10.1",
    date: "2026-05-23",
    summary: "Voice/STT input for playground via faster-whisper",
    entries: [
      {
        category: "added",
        description:
          "Microphone button in the Playground: click to record voice, click again (or the button turns red) to stop — transcript is injected into the message box automatically.",
      },
      {
        category: "added",
        description:
          "Transcription powered by faster-whisper-server (configured via WHISPER_BASE_URL, default localhost:8000) via OpenAI-compatible /v1/audio/transcriptions endpoint. Model configurable via WHISPER_MODEL env var.",
      },
      {
        category: "added",
        description:
          "New /api/transcribe server-side proxy route keeps the Whisper URL server-side and handles multipart audio forwarding.",
      },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-05-23",
    summary:
      "Colony hive UI showing orchestrators, workers, and delegation chains",
    entries: [
      {
        category: "added",
        description:
          "New Colony page (/colony) with agent cards grouped by type (orchestrators highlighted with crown icon, workers below), showing active run count, total runs, and tool allowlist per agent.",
      },
      {
        category: "added",
        description:
          "Delegation chain visualization on the Colony page: when an orchestrator spawns subagents, the parent→child run tree is rendered with status badges for each node.",
      },
      {
        category: "added",
        description:
          "Recent runs table on the Colony page shows the last 50 runs across the entire colony with parent_run_id linkage.",
      },
      {
        category: "added",
        description:
          "Colony added to the main navigation sidebar between Agents and Runs.",
      },
      {
        category: "added",
        description:
          "Agents API enhanced: list endpoint now returns active_runs count, total_runs, tool_allowlist, model_policy, and is_enabled. New /agents/colony endpoint returns full hive state.",
      },
    ],
  },
  // ── 0.9.x — Self-learning metrics dashboard ─────────────────────────────
  {
    version: "0.9.0",
    date: "2026-05-22",
    summary:
      "Self-learning metrics dashboard and verified end-to-end learning loop",
    entries: [
      {
        category: "added",
        description:
          "New Learning page (/learning) showing memory growth timeline, recent memories, reflection job history with success/failure indicators, and evolution candidates with eval scores.",
      },
      {
        category: "added",
        description:
          "Dashboard home now shows a Self-learning loop summary card with live reflection counts and a link to the full Learning dashboard.",
      },
      {
        category: "added",
        description:
          "Admin stats API extended with reflection_completed, total_memories, and evolution_pending counts.",
      },
      {
        category: "added",
        description:
          "New /admin/learning-metrics endpoint providing memory timeline (14-day), recent memories, reflection jobs, and evolution candidates in one call.",
      },
      {
        category: "added",
        description:
          "Learning nav item added to the sidebar between Skills and Admin.",
      },
    ],
  },
  // ── 0.8.x — Run creation UI, SSE streaming, admin polish ────────────────
  {
    version: "0.8.1",
    date: "2026-05-23",
    summary: "Playground metrics, scroll fix, admin users fix",
    entries: [
      {
        category: "added",
        description:
          "Per-reply metrics in the Playground — tokens in, tokens out, total tokens, time to first token (TTFT), and total response time shown beneath each assistant reply.",
      },
      {
        category: "fixed",
        description:
          "Playground conversation window now scrolls correctly as messages grow.",
      },
      {
        category: "fixed",
        description:
          "Admin Users table now loads users directly from the database instead of relying on an expiring JWT token.",
      },
      {
        category: "added",
        description:
          "conflux.sh: added `build` and `redeploy` commands; switched all UI commands from npm to bun.",
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-05-22",
    summary: "Run creation UI, live SSE streaming, admin polish",
    entries: [
      {
        category: "added",
        description:
          '"New Run" modal on the Runs page — select an agent, enter a prompt, and launch a run directly from the UI.',
      },
      {
        category: "added",
        description:
          "Live SSE streaming on the Run detail page — token output, tool calls, tool results, and status events stream in real-time while a run is active.",
      },
      {
        category: "added",
        description:
          "DELETE provider — admin can remove a provider (and its models) from the Providers page.",
      },
      {
        category: "added",
        description:
          "User management in Admin UI — promote/demote admin role and enable/disable users directly from the Users table.",
      },
    ],
  },
  // ── 0.7.x — Self-learning loop ──────────────────────────────────────────
  {
    version: "0.7.1",
    date: "2026-05-22",
    summary: "Self-learning loop bug fixes",
    entries: [
      {
        category: "fixed",
        description:
          "`_fetch_skills_block()` crashed referencing non-existent `Skill.is_active` and `Skill.tags` columns — corrected to use `approval_status == 'approved'`.",
      },
      {
        category: "fixed",
        description:
          "`CompletionRequest.tools` type mismatch — tools were already OpenAI-formatted dicts but were being passed through a broken `_tool_to_dict()` conversion.",
      },
      {
        category: "fixed",
        description:
          "Reflection job crashed with `'AgentRun' object has no attribute tenant_id` — removed stale field access.",
      },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-05-22",
    summary: "Self-learning loop — end-to-end wiring",
    entries: [
      {
        category: "added",
        description:
          "DB-backed ProviderRegistry — providers now load from the database at startup; `refresh_provider_registry()` called on FastAPI lifespan and arq worker startup.",
      },
      {
        category: "added",
        description:
          "Memory injection into agent system prompt — top-5 relevant memories from Qdrant injected as `## What I Know` context block before each run.",
      },
      {
        category: "added",
        description:
          "Skill list injection into agent system prompt — approved skills listed at level-0 for progressive disclosure; agents use `skill_read` tool to fetch full content.",
      },
      {
        category: "added",
        description:
          "Default Orchestrator agent seeded via Alembic migration 0002 (`slug=orchestrator`, full system prompt, tool allowlist).",
      },
      {
        category: "added",
        description:
          "Changelog page in the web UI — accessible from the sidebar, tracks all releases.",
      },
    ],
  },
  // ── 0.6.x — Playground ──────────────────────────────────────────────────
  {
    version: "0.6.1",
    date: "2026-05-22",
    summary: "Playground bug fixes",
    entries: [
      {
        category: "fixed",
        description:
          "Playground returned French responses — added `DEFAULT_SYSTEM_PROMPT` enforcing English in the chat API route.",
      },
      {
        category: "fixed",
        description:
          "Removed `compatibility: 'compatible'` from `createOpenAI()` — option no longer exists in @ai-sdk/openai v3.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-05-22",
    summary: "Playground system prompt configuration",
    entries: [
      {
        category: "added",
        description:
          "Playground system prompt is now configurable via a collapsible panel in the UI — override the default prompt per session.",
      },
    ],
  },
  // ── 0.5.x — Provider storage ─────────────────────────────────────────────
  {
    version: "0.5.1",
    date: "2026-05-22",
    summary: "Provider storage bug fixes",
    entries: [
      {
        category: "fixed",
        description:
          "Add Provider button was silently failing — provider mutations now route correctly through the Next.js API layer to the FastAPI backend.",
      },
      {
        category: "fixed",
        description:
          "Env-var providers were still appearing in the admin UI after removal — API now reads exclusively from the database.",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-05-22",
    summary: "DB-only provider storage",
    entries: [
      {
        category: "added",
        description:
          "Model list fetched live from the provider endpoint at add-time — no hardcoded model names.",
      },
      {
        category: "removed",
        description:
          "All provider env vars (OLLAMA_BASE_URL, VLLM_BASE_URL, etc.) removed — the database is the single source of truth for provider config.",
      },
    ],
  },
  // ── 0.4.x — Providers admin UI ──────────────────────────────────────────
  {
    version: "0.4.0",
    date: "2026-05-22",
    summary: "Providers admin UI",
    entries: [
      {
        category: "added",
        description:
          "Admin-only Providers page for managing LLM provider connections.",
      },
      {
        category: "added",
        description:
          "Provider and provider_models tables seeded from initial config.",
      },
      {
        category: "changed",
        description: "Providers route now requires admin role.",
      },
    ],
  },
  // ── 0.3.x — SSO auth ────────────────────────────────────────────────────
  {
    version: "0.3.1",
    date: "2026-05-22",
    summary: "Auth bug fixes",
    entries: [
      {
        category: "fixed",
        description:
          "JWT session token was not refreshing before expiry (~1 hr) — token refresh now runs automatically.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-05-22",
    summary: "SSO auth and user provisioning",
    entries: [
      {
        category: "added",
        description:
          "Azure AD SSO login via NextAuth — users are auto-provisioned in the Conflux DB on first login.",
      },
      {
        category: "added",
        description:
          "Admin flag propagated from DB — first registered user is automatically promoted to admin.",
      },
    ],
  },
  // ── 0.2.x — Full stack ──────────────────────────────────────────────────
  {
    version: "0.2.0",
    date: "2026-05-22",
    summary: "Full stack built and validated",
    entries: [
      {
        category: "added",
        description: "FastAPI backend on port 8001 with 25+ REST endpoints.",
      },
      {
        category: "added",
        description:
          "Next.js 14 web UI with Dashboard, Agents, Runs, Playground, Memory, Skills, and Admin pages.",
      },
      {
        category: "added",
        description:
          "arq background worker for async jobs (reflection, evolution).",
      },
      {
        category: "added",
        description:
          "Qdrant vector store integration for memory semantic search.",
      },
      {
        category: "added",
        description: "DragonflyDB (Redis-compatible) queue for arq jobs.",
      },
    ],
  },
  // ── 0.1.x — Foundation ──────────────────────────────────────────────────
  {
    version: "0.1.0",
    date: "2026-05-22",
    summary: "Conflux AI Harness foundation",
    entries: [
      {
        category: "added",
        description:
          "Initial project scaffold — Python FastAPI backend, Next.js frontend, Postgres, Qdrant, DragonflyDB.",
      },
      {
        category: "added",
        description:
          "SQLAlchemy async models: User, Tenant, Agent, AgentRun, Skill, Memory, Provider, TraceEvent.",
      },
      {
        category: "added",
        description: "Alembic migrations for full schema.",
      },
      {
        category: "added",
        description:
          "Multi-provider LLM abstraction layer (vLLM, Ollama, LlamaCpp, LM Studio, OpenAI-compat).",
      },
      {
        category: "added",
        description:
          "Core agent loop with tool execution, trace recording, and reflection scheduling.",
      },
    ],
  },
];
