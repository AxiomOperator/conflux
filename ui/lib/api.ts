export interface Agent {
  active_runs?: number;
  agent_type: string;
  created_at: string;
  description: string;
  id: string;
  is_enabled?: boolean;
  max_iterations?: number;
  model_policy?: Record<string, unknown>;
  name: string;
  slug?: string;
  status: string;
  system_prompt?: string;
  tenant_id: string;
  tool_allowlist?: string[];
  total_runs?: number;
}

export interface ColonyRun {
  agent_id: string;
  created_at: string;
  id: string;
  parent_run_id: string | null;
  status: string;
}

export interface ColonyState {
  agents: Agent[];
  recent_runs: ColonyRun[];
}

export interface AgentCreateInput {
  agent_type: string;
  description?: string;
  max_iterations: number;
  model_policy: Record<string, unknown>;
  name: string;
  retrieval_tags: string[];
  system_prompt: string;
  tool_allowlist: string[];
}

export interface AgentUpdateInput {
  description?: string;
  is_enabled?: boolean;
  model_policy?: Record<string, unknown>;
  name?: string;
  system_prompt?: string;
  tool_allowlist?: string[];
}

export interface AgentRun {
  agent_id: string;
  agent_name?: string;
  completed_at?: string | null;
  compressed_at?: string | null;
  created_at: string;
  id: string;
  input: string;
  is_compressed?: boolean;
  output?: string;
  raw_input?: unknown;
  raw_output?: unknown;
  started_at?: string | null;
  status: string;
  steps?: unknown[];
  tenant_id: string;
  token_usage?: Record<string, unknown> | null;
}

export interface MemoryEntry {
  content: string;
  created_at: string;
  id: string;
  importance: number;
  key?: string;
  scope: string;
  tags?: string[];
  tenant_id: string;
}

export interface Skill {
  approval_status: string;
  category?: string;
  created_at: string;
  description: string;
  id: string;
  name: string;
  slug: string;
  tenant_id: string;
  version: string;
}

export interface SkillCreateInput {
  auto_approve: boolean;
  category?: string;
  content: string;
  description: string;
  is_global: boolean;
  name: string;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  author: string;
  description: string;
  githubUrl: string;
  skillUrl: string;
  stars: number;
  updatedAt: string;
}

export interface MarketplaceSearchResult {
  skills: MarketplaceSkill[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Provider {
  base_url: string;
  default_model: string;
  health_status?: string;
  healthy?: boolean;
  id?: string;
  name: string;
  provider_type: string;
}

export interface ProviderModelEntry {
  context_length?: number | null;
  created_at: string;
  display_name?: string | null;
  id: string;
  input_cost_per_1k: number;
  model_name: string;
  output_cost_per_1k: number;
}

export interface UserRecord {
  display_name: string;
  email: string;
  id: string;
  is_active: boolean;
  is_admin: boolean;
  role: "admin" | "member";
}

export interface UserWorkspace {
  project_id: string;
  tenant_id: string | null;
  orchestrator_id: string | null;
  orchestrator_name: string | null;
}

export interface CurrentUser {
  display_name: string;
  email: string;
  id: string;
  is_admin: boolean;
  view_as_user?: boolean;
  workspace: UserWorkspace | null;
}

export function isEffectiveAdmin(
  user: Pick<CurrentUser, "is_admin" | "view_as_user"> | null | undefined,
  fallbackIsAdmin = false,
) {
  return Boolean((user?.is_admin ?? fallbackIsAdmin) && !user?.view_as_user);
}

export interface WikiSpace {
  default_access?: string | null;
  description?: string | null;
  icon?: string | null;
  id: string;
  name: string;
  page_count?: number;
  slug: string;
}

export interface WikiPageTreeNode {
  children: WikiPageTreeNode[];
  id: string;
  parent_page_id: string | null;
  position: number;
  slug: string;
  title: string;
}

export interface WikiPageDetail {
  content_markdown: string;
  created_by_display_name?: string | null;
  external_links?: Array<{ title: string; url: string }>;
  id: string;
  internal_links?: Array<{ title: string; page_id: string }>;
  parent_page_id?: string | null;
  slug: string;
  sources?: Array<{ title: string; url: string }>;
  space_id: string;
  tags?: string[];
  title: string;
  updated_at?: string | null;
  updated_by_display_name?: string | null;
}

export interface WikiPageVersion {
  created_at?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
  created_by_name?: string | null;
  id: string;
  page_id?: string | null;
  summary?: string | null;
  version_number?: number | null;
}

export interface WikiSearchResult {
  id?: string;
  page_id?: string;
  snippet?: string | null;
  space_id?: string;
  space_slug?: string;
  title: string;
}

export interface PersonaFiles {
  agents_md: string | null;
  soul_md: string | null;
  user_md: string | null;
  identity_md: string | null;
  tools_md: string | null;
  heartbeat_md: string | null;
  boot_md: string | null;
}

export interface AdminStats {
  completed_runs: number;
  evolution_pending: number;
  pending_skills: number;
  reflection_completed: number;
  reflection_pending: number;
  running_runs: number;
  total_memories: number;
  total_runs: number;
}

export interface ToolRecord {
  name: string;
  description: string;
  description_override: string | null;
  original_description?: string;
  risk_level: string;
  requires_approval: boolean;
  is_enabled: boolean;
  is_builtin: boolean;
  endpoint_url: string | null;
  http_method: string | null;
  custom_headers: Record<string, string> | null;
  parameters: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transport: "stdio" | "sse";
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
  risk_level: "safe" | "moderate" | "destructive";
  is_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface McpServerCreate {
  name: string;
  description?: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  risk_level?: "safe" | "moderate" | "destructive";
  is_enabled?: boolean;
}

export interface McpToolDefinition {
  name: string;
  original_name: string;
  server_name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpTestResult {
  status: "connected" | "error";
  tools: McpToolDefinition[];
  tool_count: number;
  error?: string;
}

export interface AgentMailStatus {
  configured: boolean;
}

export interface AgentMailInbox {
  created_at?: string | null;
  display_name?: string | null;
  email_address: string;
  inbox_id: string;
  updated_at?: string | null;
}

export interface AgentMailMessage {
  created_at?: string | null;
  from?: string | string[];
  message_id: string;
  preview?: string | null;
  subject?: string | null;
  thread_id?: string | null;
  timestamp?: string | null;
  to?: string | string[];
  updated_at?: string | null;
}

export interface AgentMailThread {
  created_at?: string | null;
  message_count?: number;
  preview?: string | null;
  recipients?: string | string[];
  senders?: string | string[];
  subject?: string | null;
  thread_id: string;
  timestamp?: string | null;
  updated_at?: string | null;
}

export interface ScheduledTask {
  id: string;
  user_id: string | null;
  agent_id: string;
  name: string;
  schedule: string;
  nl_schedule: string | null;
  input_template: Record<string, unknown>;
  channel: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ScheduledTaskCreate {
  name: string;
  agent_id: string;
  schedule: string;
  nl_schedule?: string;
  input_template?: Record<string, unknown>;
  channel?: string;
  enabled?: boolean;
}

export type ScheduledTaskUpdate = Partial<ScheduledTaskCreate>;

export interface ToolUpdate {
  description_override?: string | null;
  risk_level?: string;
  requires_approval?: boolean;
  is_enabled?: boolean;
}

export interface ToolCreate {
  name: string;
  description: string;
  risk_level: string;
  requires_approval: boolean;
  endpoint_url: string;
  http_method: string;
  custom_headers?: Record<string, string> | null;
  custom_parameters?: Record<string, unknown> | null;
}

export interface EvolutionCandidate {
  approval_status: string;
  created_at: string;
  current_content?: string | null;
  eval_score: number | null;
  id: string;
  proposed_content?: string | null;
  rationale: string;
  skill_id?: string | null;
  type: string;
}

export interface LearnedMemory {
  key: string;
  scope?: string;
  tags?: string[];
  value: string;
}

export interface ReflectionJob {
  created_at: string;
  drafted_skills: string[];
  error: string | null;
  id: string;
  learned_memories: LearnedMemory[];
  memories_count: number;
  run_id: string;
  skills_count: number;
  status: string;
  was_successful: boolean | null;
}

export interface LearningMemoryRecord {
  created_at: string;
  id: string;
  key: string;
  scope: string;
  tags: string[];
  value: string;
}

export interface LearningMetrics {
  evolution_candidates: EvolutionCandidate[];
  memory_timeline: { count: number; day: string }[];
  recent_memories: LearningMemoryRecord[];
  reflection_jobs: ReflectionJob[];
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  token?: string;
  internal?: boolean;
  internalSecret?: string;
  internalEmail?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? API_BASE_URL;
const API_V1_BASE_URL = `${API_BASE_URL}/v1`;
const INTERNAL_API_V1_BASE_URL = `${INTERNAL_API_URL}/v1`;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function normalizeAgent(raw: unknown): Agent {
  const value = isRecord(raw) ? raw : {};
  return {
    active_runs: typeof value.active_runs === "number" ? value.active_runs : 0,
    agent_type: asString(value.agent_type, asString(value.type, "worker")),
    created_at: asString(value.created_at),
    description: asString(value.description),
    id: asString(value.id),
    is_enabled: typeof value.is_enabled === "boolean" ? value.is_enabled : true,
    max_iterations:
      typeof value.max_iterations === "number"
        ? value.max_iterations
        : undefined,
    model_policy: isRecord(value.model_policy)
      ? (value.model_policy as Record<string, unknown>)
      : {},
    name: asString(value.name, "Unnamed agent"),
    slug: asString(value.slug) || undefined,
    status: asString(
      value.status,
      asBoolean(value.is_enabled, true) ? "active" : "idle",
    ),
    system_prompt: asString(value.system_prompt) || undefined,
    tenant_id: asString(value.tenant_id),
    tool_allowlist: Array.isArray(value.tool_allowlist)
      ? (value.tool_allowlist as string[])
      : [],
    total_runs: typeof value.total_runs === "number" ? value.total_runs : 0,
  };
}

function extractSteps(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  if (Array.isArray(value.steps)) {
    return value.steps;
  }

  if (Array.isArray(value.events)) {
    return value.events;
  }

  return undefined;
}

function normalizeRun(raw: unknown): AgentRun {
  const value = isRecord(raw) ? raw : {};
  const rawInput = value.input;
  const rawOutput = value.output;
  return {
    agent_id: asString(value.agent_id),
    agent_name: asString(value.agent_name) || undefined,
    completed_at: asString(value.completed_at) || null,
    compressed_at: asString(value.compressed_at) || null,
    created_at: asString(value.created_at, asString(value.started_at)),
    id: asString(value.id, asString(value.run_id)),
    input: jsonString(rawInput),
    is_compressed:
      typeof value.is_compressed === "boolean" ? value.is_compressed : false,
    output: rawOutput === undefined ? undefined : jsonString(rawOutput),
    raw_input: rawInput,
    raw_output: rawOutput,
    started_at: asString(value.started_at) || null,
    status: asString(value.status, "unknown"),
    steps: extractSteps(rawOutput),
    tenant_id: asString(value.tenant_id),
    token_usage: isRecord(value.token_usage)
      ? (value.token_usage as Record<string, unknown>)
      : null,
  };
}

function normalizeMemory(raw: unknown, scope: string): MemoryEntry {
  const value = isRecord(raw) ? raw : {};
  return {
    content: asString(value.content, asString(value.value)),
    created_at: asString(value.created_at),
    id: asString(value.id),
    importance: asNumber(value.importance),
    key: asString(value.key) || undefined,
    scope: asString(value.scope, scope),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    tenant_id: asString(value.tenant_id),
  };
}

function normalizeSkill(raw: unknown): Skill {
  const value = isRecord(raw) ? raw : {};
  return {
    approval_status: asString(
      value.approval_status,
      asString(value.status, "approved"),
    ),
    created_at: asString(value.created_at),
    description: asString(value.description),
    id: asString(value.id),
    name: asString(value.name, asString(value.slug, "Unnamed skill")),
    slug: asString(value.slug),
    tenant_id: asString(value.tenant_id),
    version:
      typeof value.version === "number" || typeof value.version === "string"
        ? String(value.version)
        : "—",
  };
}

function normalizeProvider(raw: unknown, models: string[] = []): Provider {
  const value = isRecord(raw) ? raw : {};
  const healthStatus = asString(
    value.health_status,
    asString(value.health, "unknown"),
  );
  const defaultModel = models[0] ?? asString(value.default_model, "—");
  return {
    base_url: asString(value.base_url),
    default_model: defaultModel,
    health_status: healthStatus,
    healthy: healthStatus === "healthy" || asBoolean(value.healthy),
    id: asString(value.id) || undefined,
    name: asString(value.name, "Unnamed provider"),
    provider_type: asString(
      value.provider_type,
      asString(value.type, "provider"),
    ),
  };
}

function normalizeUser(raw: unknown): UserRecord {
  const value = isRecord(raw) ? raw : {};
  const isAdmin = asBoolean(value.is_admin);
  return {
    display_name: asString(value.display_name),
    email: asString(value.email),
    id: asString(value.id),
    is_active: asBoolean(value.is_active, true),
    is_admin: isAdmin,
    role: isAdmin ? "admin" : "member",
  };
}

function normalizeCurrentUser(raw: unknown): CurrentUser {
  const value = isRecord(raw) ? raw : {};
  const ws = isRecord(value.workspace) ? value.workspace : null;
  return {
    display_name: asString(value.display_name),
    email: asString(value.email),
    id: asString(value.id),
    is_admin: asBoolean(value.is_admin),
    view_as_user: asBoolean(value.view_as_user),
    workspace: ws
      ? {
          project_id: asString(ws.project_id),
          tenant_id: ws.tenant_id ? asString(ws.tenant_id) : null,
          orchestrator_id: ws.orchestrator_id
            ? asString(ws.orchestrator_id)
            : null,
          orchestrator_name: ws.orchestrator_name
            ? asString(ws.orchestrator_name)
            : null,
        }
      : null,
  };
}

function normalizeEvolutionCandidate(raw: unknown): EvolutionCandidate {
  const value = isRecord(raw) ? raw : {};
  return {
    approval_status: asString(value.approval_status, "pending"),
    created_at: asString(value.created_at),
    current_content:
      typeof value.current_content === "string" ? value.current_content : null,
    eval_score: typeof value.eval_score === "number" ? value.eval_score : null,
    id: asString(value.id),
    proposed_content:
      typeof value.proposed_content === "string"
        ? value.proposed_content
        : null,
    rationale: asString(value.rationale),
    skill_id: asString(value.skill_id) || null,
    type: asString(value.type, asString(value.candidate_type, "candidate")),
  };
}

function buildUrl(path: string, internal = false) {
  const base = internal ? INTERNAL_API_V1_BASE_URL : API_V1_BASE_URL;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const errorBody = (await response.json()) as {
        detail?: string;
        message?: string;
      };
      message = errorBody.detail ?? errorBody.message ?? message;
    } catch {
      // Ignore JSON parse failures for empty or plain-text responses.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const body =
    typeof options.body === "string" || options.body instanceof FormData
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

  headers.set("Accept", "application/json");
  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...options,
    body,
    cache: options.cache ?? "no-store",
    headers,
  });

  return parseJsonResponse<T>(response);
}

async function request<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const body =
    typeof options.body === "string" || options.body instanceof FormData
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

  headers.set("Accept", "application/json");
  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (options.internalSecret && options.internalEmail) {
    headers.set("X-Internal-Secret", options.internalSecret);
    headers.set("X-User-Email", options.internalEmail);
  } else if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(buildUrl(path, options.internal), {
    ...options,
    body,
    cache: options.cache ?? "no-store",
    headers,
  });

  return parseJsonResponse<T>(response);
}

export function createApiClient(
  token?: string,
  internal = false,
  internalAuth?: { internalSecret?: string; internalEmail?: string },
) {
  const opt = (extra: ApiRequestOptions = {}): ApiRequestOptions => ({
    ...extra,
    token,
    internal,
    ...(internalAuth?.internalSecret && internalAuth?.internalEmail
      ? {
          internalSecret: internalAuth.internalSecret,
          internalEmail: internalAuth.internalEmail,
        }
      : {}),
  });
  return {
    admin: {
      async approveCandidate(candidateId: string) {
        return request<{ approved: boolean }>(
          `/admin/evolution-candidates/${candidateId}/approve`,
          opt({ method: "POST" }),
        );
      },
      async evolutionCandidates(limit = 20) {
        const results = await request<unknown[]>(
          `/admin/evolution-candidates?limit=${limit}`,
          opt(),
        );
        return results.map(normalizeEvolutionCandidate);
      },
      async learningMetrics() {
        return request<LearningMetrics>("/admin/learning-metrics", opt());
      },
      async rejectCandidate(candidateId: string) {
        return request<{ rejected: boolean }>(
          `/admin/evolution-candidates/${candidateId}/reject`,
          opt({ method: "POST" }),
        );
      },
      async stats() {
        return request<AdminStats>("/admin/stats", opt());
      },
    },
    agentmail: {
      async status() {
        return request<AgentMailStatus>("/admin/agentmail/status", opt());
      },
      async listInboxes(limit = 100) {
        const params = new URLSearchParams({ limit: String(limit) });
        return request<{ inboxes: AgentMailInbox[] }>(
          `/admin/agentmail/inboxes?${params.toString()}`,
          opt(),
        );
      },
      async createInbox(body: { display_name?: string; username?: string }) {
        return request<AgentMailInbox>(
          "/admin/agentmail/inboxes",
          opt({ method: "POST", body }),
        );
      },
      async deleteInbox(inboxId: string) {
        return request<void>(
          `/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}`,
          opt({ method: "DELETE" }),
        );
      },
      async listMessages(inboxId: string, limit = 20) {
        const params = new URLSearchParams({ limit: String(limit) });
        return request<{ messages: AgentMailMessage[] }>(
          `/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}/messages?${params.toString()}`,
          opt(),
        );
      },
      async listThreads(inboxId: string, limit = 20) {
        const params = new URLSearchParams({ limit: String(limit) });
        return request<{ threads: AgentMailThread[] }>(
          `/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}/threads?${params.toString()}`,
          opt(),
        );
      },
    },
    agents: {
      async create(input: AgentCreateInput) {
        return request<{ id: string; name: string; slug: string }>(
          "/agents",
          opt({ body: input, method: "POST" }),
        );
      },
      async update(agentId: string, input: AgentUpdateInput) {
        return request<{ id: string; updated: boolean }>(
          `/agents/${agentId}`,
          opt({ body: input, method: "PATCH" }),
        );
      },
      async delete(agentId: string) {
        return request<void>(`/agents/${agentId}`, opt({ method: "DELETE" }));
      },
      async colony() {
        return request<ColonyState>("/agents/colony", opt());
      },
      async get(agentId: string) {
        return normalizeAgent(
          await request<unknown>(`/agents/${agentId}`, opt()),
        );
      },
      async list() {
        const results = await request<unknown[]>("/agents", opt());
        return results.map(normalizeAgent);
      },
    },
    memory: {
      async list(scope: "global" | "session" | "user", query = "") {
        const params = new URLSearchParams({ scope });
        if (query) {
          params.set("query", query);
        }
        const results = await request<{ memories?: unknown[] }>(
          `/memory?${params.toString()}`,
          opt(),
        );
        return (results.memories ?? []).map((entry) =>
          normalizeMemory(entry, scope),
        );
      },
      async search(query: string) {
        const params = new URLSearchParams({ query });
        const results = await request<{ memories?: unknown[] }>(
          `/memory/search?${params.toString()}`,
          opt(),
        );
        const memories = results.memories ?? [];
        return memories.map((entry) =>
          normalizeMemory(
            entry,
            asString((entry as Record<string, unknown>).scope, "user"),
          ),
        );
      },
      async delete(memoryId: string) {
        await request<void>(`/memory/${memoryId}`, {
          ...opt(),
          method: "DELETE",
        });
      },
    },
    providers: {
      async list() {
        const results = await request<unknown[]>("/providers", opt());
        // Backend now returns default_model directly — skip extra model fetches
        return results.map((entry) => normalizeProvider(entry));
      },
      async create(body: {
        name: string;
        provider_type: string;
        base_url: string;
        api_key?: string;
        default_model?: string;
      }) {
        return request<{ id: string; name: string }>(
          "/providers",
          opt({ method: "POST", body: JSON.stringify(body) }),
        );
      },
      async recheckHealth(providerId: string) {
        return request<{ healthy: boolean }>(
          `/providers/${providerId}/health-check`,
          opt({ method: "POST" }),
        );
      },
      async delete(providerId: string) {
        return request<null>(
          `/providers/${providerId}`,
          opt({ method: "DELETE" }),
        );
      },
      async listModels(providerId: string) {
        const result = await request<{ models?: unknown[] }>(
          `/providers/${providerId}/models`,
          opt(),
        );
        return (result.models ?? []) as string[];
      },
      async listRegisteredModels(providerId: string) {
        const result = await request<{ models?: unknown[] }>(
          `/providers/${providerId}/registered-models`,
          opt(),
        );
        return (result.models ?? []) as ProviderModelEntry[];
      },
      async addModel(
        providerId: string,
        body: {
          model_name: string;
          display_name?: string;
          context_length?: number;
          input_cost_per_1k?: number;
          output_cost_per_1k?: number;
        },
      ) {
        return request<{ id: string; model_name: string }>(
          `/providers/${providerId}/models`,
          opt({ method: "POST", body }),
        );
      },
      async removeModel(providerId: string, modelId: string) {
        return request<null>(
          `/providers/${providerId}/models/${modelId}`,
          opt({ method: "DELETE" }),
        );
      },
    },
    runs: {
      async create(body: {
        agent_id: string;
        messages: { role: string; content: string }[];
        session_id?: string;
      }) {
        return request<{ run_id: string; status: string }>(
          "/runs",
          opt({ method: "POST", body }),
        );
      },
      async compress(runId: string) {
        return request<{ summary: string; compressed_at: string }>(
          `/runs/${runId}/compress`,
          opt({ method: "POST" }),
        );
      },
      async retry(runId: string) {
        return request<{ run_id: string; status: string }>(
          `/runs/${runId}/retry`,
          opt({ method: "POST" }),
        );
      },
      async undo(runId: string) {
        return request<{ success: boolean; run_id: string }>(
          `/runs/${runId}/undo`,
          opt({ method: "POST" }),
        );
      },
      async get(runId: string) {
        return normalizeRun(await request<unknown>(`/runs/${runId}`, opt()));
      },
      async list(limit = 20) {
        const results = await request<unknown[]>(`/runs?limit=${limit}`, opt());
        return results.map(normalizeRun);
      },
      async search(
        query: string,
        options?: { agentId?: string; limit?: number },
      ) {
        const params = new URLSearchParams({ query });
        if (options?.limit) {
          params.set("limit", String(options.limit));
        }
        if (options?.agentId) {
          params.set("agent_id", options.agentId);
        }
        const results = await request<unknown[]>(
          `/runs/search?${params.toString()}`,
          opt(),
        );
        return results.map(normalizeRun);
      },
    },
    skills: {
      async approve(skillId: string) {
        return request<{ approved: boolean }>(
          `/skills/${skillId}/approve`,
          opt({ method: "POST" }),
        );
      },
      async create(input: SkillCreateInput) {
        return request<Skill>(
          "/skills",
          opt({ method: "POST", body: JSON.stringify(input) }),
        );
      },
      async list() {
        const results = await request<unknown[]>("/skills", opt());
        return results.map(normalizeSkill);
      },
      async pending() {
        const results = await request<unknown[]>("/skills/pending", opt());
        return results.map(normalizeSkill);
      },
      async reject(skillId: string) {
        return request<{ deprecated: boolean }>(
          `/skills/${skillId}/deprecate`,
          opt({ method: "POST" }),
        );
      },
      async marketplaceSearch(
        q: string,
        params?: {
          page?: number;
          limit?: number;
          sort_by?: string;
          category?: string;
        },
      ) {
        const qs = new URLSearchParams({ q });
        for (const [k, v] of Object.entries(params ?? {})) {
          if (v != null) qs.set(k, String(v));
        }
        const res = await fetch(`/api/skills/marketplace/search?${qs}`, {
          credentials: "include",
        });
        if (!res.ok)
          throw new Error(`Marketplace search failed: ${res.status}`);
        return res.json() as Promise<MarketplaceSearchResult>;
      },
      async marketplaceImport(skill: MarketplaceSkill) {
        const res = await fetch("/api/skills/marketplace/import", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            github_url: skill.githubUrl,
            author: skill.author,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail ?? "Import failed");
        return data as Skill;
      },
    },
    users: {
      async list(limit = 50) {
        const results = await request<unknown[]>(
          `/users?limit=${limit}`,
          opt(),
        );
        return results.map(normalizeUser);
      },
      async me() {
        return normalizeCurrentUser(await request<unknown>("/users/me", opt()));
      },
      async updateUser(
        userId: string,
        body: { is_admin?: boolean; is_active?: boolean },
      ) {
        return request<{ id: string; updated: boolean }>(
          `/users/${userId}`,
          opt({ method: "PATCH", body }),
        );
      },
      async getPersona() {
        return request<PersonaFiles>("/users/me/persona", opt());
      },
      async updatePersona(body: Partial<PersonaFiles>) {
        return request<PersonaFiles>(
          "/users/me/persona",
          opt({ method: "PATCH", body }),
        );
      },
    },
    tools: {
      async list() {
        const result = await request<{ tools: ToolRecord[] }>("/tools", opt());
        return result.tools ?? [];
      },
      async update(name: string, body: ToolUpdate) {
        return request<{ name: string; updated: boolean }>(
          `/tools/${encodeURIComponent(name)}`,
          opt({ method: "PATCH", body }),
        );
      },
      async create(body: ToolCreate) {
        return request<{ name: string; created: boolean }>(
          "/tools",
          opt({ method: "POST", body }),
        );
      },
      async delete(name: string) {
        return request<{ name: string; deleted: boolean }>(
          `/tools/${encodeURIComponent(name)}`,
          opt({ method: "DELETE" }),
        );
      },
    },
    mcp: {
      async listServers() {
        return request<McpServer[]>("/mcp/servers", opt());
      },
      async createServer(body: McpServerCreate) {
        return request<McpServer>(
          "/mcp/servers",
          opt({ method: "POST", body }),
        );
      },
      async updateServer(id: string, body: Partial<McpServerCreate>) {
        return request<McpServer>(
          `/mcp/servers/${id}`,
          opt({ method: "PUT", body }),
        );
      },
      async deleteServer(id: string) {
        return request<void>(`/mcp/servers/${id}`, opt({ method: "DELETE" }));
      },
      async testServer(id: string) {
        return request<McpTestResult>(
          `/mcp/servers/${id}/test`,
          opt({ method: "POST" }),
        );
      },
      async listAgentServers(agentId: string) {
        return request<McpServer[]>(`/mcp/agents/${agentId}/servers`, opt());
      },
      async assignServerToAgent(agentId: string, mcpServerId: string) {
        return request<{ agent_id: string; mcp_server_id: string }>(
          `/mcp/agents/${agentId}/servers`,
          opt({ method: "POST", body: { mcp_server_id: mcpServerId } }),
        );
      },
      async unassignServerFromAgent(agentId: string, mcpServerId: string) {
        return request<void>(
          `/mcp/agents/${agentId}/servers/${mcpServerId}`,
          opt({ method: "DELETE" }),
        );
      },
    },
    schedules: {
      async list() {
        return request<ScheduledTask[]>("/schedules", opt());
      },
      async create(body: ScheduledTaskCreate) {
        return request<ScheduledTask>(
          "/schedules",
          opt({ method: "POST", body }),
        );
      },
      async get(id: string) {
        return request<ScheduledTask>(`/schedules/${id}`, opt());
      },
      async update(id: string, body: ScheduledTaskUpdate) {
        return request<ScheduledTask>(
          `/schedules/${id}`,
          opt({ method: "PATCH", body }),
        );
      },
      async delete(id: string) {
        return request<void>(`/schedules/${id}`, opt({ method: "DELETE" }));
      },
      async runNow(id: string) {
        return request<{ run_id: string }>(
          `/schedules/${id}/run-now`,
          opt({ method: "POST" }),
        );
      },
    },
  };
}
