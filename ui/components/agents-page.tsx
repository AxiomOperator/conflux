"use client";

import { Copy, Loader2, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  Agent,
  AgentCreateInput,
  AgentUpdateInput,
  McpServer,
} from "@/lib/api";
import { createApiClient, isEffectiveAdmin } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const KNOWN_TOOLS = [
  "web_search",
  "memory_read",
  "memory_write",
  "http_fetch",
  "skill_list",
  "skill_read",
  "skill_draft",
  "shell_exec",
] as const;

const blankCreateForm: AgentCreateInput = {
  agent_type: "worker",
  description: "",
  max_iterations: 20,
  model_policy: {},
  name: "",
  retrieval_tags: [],
  system_prompt: "You are a helpful Conflux agent.",
  tool_allowlist: [],
};

// ── helpers ────────────────────────────────────────────────────────────────

function ToolPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  function toggle(tool: string) {
    onChange(
      selected.includes(tool)
        ? selected.filter((t) => t !== tool)
        : [...selected, tool],
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {KNOWN_TOOLS.map((tool) => {
        const active = selected.includes(tool);
        return (
          <button
            key={tool}
            type="button"
            onClick={() => toggle(tool)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {tool}
          </button>
        );
      })}
    </div>
  );
}

function PolicyEditor({
  rows,
  onChange,
}: {
  rows: [string, string][];
  onChange: (rows: [string, string][]) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="Task type (e.g. coding)"
            value={row[0]}
            onChange={(e) =>
              onChange(
                rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)),
              )
            }
          />
          <Input
            className="flex-1"
            placeholder="Model name (e.g. gpt-4o)"
            value={row[1]}
            onChange={(e) =>
              onChange(
                rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)),
              )
            }
          />
          <Button
            size="icon"
            type="button"
            variant="ghost"
            className="shrink-0"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        type="button"
        variant="outline"
        onClick={() => onChange([...rows, ["", ""]])}
      >
        <Plus className="mr-1 size-3" />
        Add mapping
      </Button>
    </div>
  );
}

type AgentMcpClient = ReturnType<typeof createApiClient> & {
  mcp: {
    listServers: () => Promise<McpServer[]>;
    listAgentServers: (agentId: string) => Promise<McpServer[]>;
    assignServerToAgent: (
      agentId: string,
      mcpServerId: string,
    ) => Promise<unknown>;
    unassignServerFromAgent: (
      agentId: string,
      mcpServerId: string,
    ) => Promise<unknown>;
  };
};

function getMcpBadgeClasses(riskLevel: McpServer["risk_level"]) {
  if (riskLevel === "safe") {
    return "border-green-500 text-green-700 dark:text-green-400";
  }
  if (riskLevel === "destructive") {
    return "border-red-500 text-red-700 dark:text-red-400";
  }
  return "border-yellow-500 text-yellow-700 dark:text-yellow-400";
}

function getMcpClient(accessToken: string) {
  return createApiClient(accessToken) as AgentMcpClient;
}

function AgentMcpPanel({
  agentId,
  accessToken,
}: {
  agentId: string;
  accessToken: string;
}) {
  const [allServers, setAllServers] = useState<McpServer[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const client = getMcpClient(accessToken);
        const [all, assigned] = await Promise.all([
          client.mcp.listServers(),
          client.mcp.listAgentServers(agentId),
        ]);
        if (cancelled) return;
        setAllServers(all);
        setAssignedIds(new Set(assigned.map((server) => server.id)));
      } catch {
        if (!cancelled) {
          setError("Failed to load MCP servers.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [accessToken, agentId]);

  async function toggleServer(serverId: string, currentlyAssigned: boolean) {
    setError(null);
    setToggling(serverId);
    try {
      const client = getMcpClient(accessToken);
      if (currentlyAssigned) {
        await client.mcp.unassignServerFromAgent(agentId, serverId);
        setAssignedIds((prev) => {
          const next = new Set(prev);
          next.delete(serverId);
          return next;
        });
      } else {
        await client.mcp.assignServerToAgent(agentId, serverId);
        setAssignedIds((prev) => new Set([...prev, serverId]));
      }
    } catch {
      setError("Failed to update MCP assignment.");
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">MCP Tools</h3>
        <p className="text-xs text-muted-foreground">
          Assign external MCP servers that this agent can access.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">
          Loading MCP servers...
        </div>
      ) : null}

      {!loading && error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : null}

      {!loading && !error && allServers.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No MCP servers configured. Add servers in{" "}
          <a href="/admin/mcp" className="underline text-primary">
            Admin → MCP Servers
          </a>
          .
        </div>
      ) : null}

      {!loading && !error && allServers.length > 0 ? (
        <div className="space-y-2">
          {allServers.map((server) => {
            const assigned = assignedIds.has(server.id);
            return (
              <div
                key={server.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="flex items-center gap-2 pt-0.5">
                    <Switch
                      checked={assigned}
                      onCheckedChange={() =>
                        void toggleServer(server.id, assigned)
                      }
                      disabled={toggling === server.id || !server.is_enabled}
                    />
                    {toggling === server.id ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium">{server.name}</div>
                      {assigned ? (
                        <Badge variant="secondary" className="text-xs">
                          assigned
                        </Badge>
                      ) : null}
                    </div>
                    {server.description ? (
                      <div className="text-xs text-muted-foreground">
                        {server.description}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs uppercase">
                    {server.transport}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${getMcpBadgeClasses(server.risk_level)}`}
                  >
                    {server.risk_level}
                  </Badge>
                  {!server.is_enabled ? (
                    <Badge variant="secondary" className="text-xs">
                      disabled
                    </Badge>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export function AgentsPage({ agents: initialAgents }: { agents: Agent[] }) {
  const router = useRouter();
  const { data: session } = useSession();

  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (!session?.accessToken) return;
    const client = createApiClient(session.accessToken);
    client.users
      .me()
      .then((me) => setCanManage(isEffectiveAdmin(me)))
      .catch(() => {});
    // Reload agents client-side in case server-side fetch failed
    if (initialAgents.length === 0) {
      client.agents
        .list()
        .then((list) => setAgents(list))
        .catch(() => {});
    }
  }, [session?.accessToken, initialAgents.length]);

  // optimistic local agent state so toggles feel instant
  const [agents, setAgents] = useState<Agent[]>(initialAgents);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<AgentCreateInput>(blankCreateForm);
  const [createPolicyRows, setCreatePolicyRows] = useState<[string, string][]>(
    [],
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState<AgentUpdateInput>({});
  const [editPolicyRows, setEditPolicyRows] = useState<[string, string][]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Row-level busy IDs (enable/disable/delete)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  function openEdit(agent: Agent) {
    setEditTarget(agent);
    setEditForm({
      description: agent.description ?? "",
      is_enabled: agent.status !== "disabled",
      model_policy: (agent.model_policy as Record<string, unknown>) ?? {},
      name: agent.name,
      system_prompt: agent.system_prompt ?? "",
      tool_allowlist: agent.tool_allowlist ?? [],
    });
    setEditPolicyRows(
      Object.entries((agent.model_policy as Record<string, string>) ?? {}) as [
        string,
        string,
      ][],
    );
    setEditError(null);
  }

  const toggleEnabled = useCallback(
    async (agent: Agent) => {
      if (!session?.accessToken) return;
      const newEnabled = agent.status === "disabled";
      setBusyIds((prev) => new Set(prev).add(agent.id));
      // optimistic
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? { ...a, status: newEnabled ? "active" : "disabled" }
            : a,
        ),
      );
      try {
        await createApiClient(session.accessToken).agents.update(agent.id, {
          is_enabled: newEnabled,
        });
        router.refresh();
      } catch {
        // revert
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id ? { ...a, status: agent.status } : a,
          ),
        );
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        });
      }
    },
    [session?.accessToken, router],
  );

  const deleteAgent = useCallback(
    async (agent: Agent) => {
      if (!session?.accessToken) return;
      setBusyIds((prev) => new Set(prev).add(agent.id));
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      try {
        await createApiClient(session.accessToken).agents.delete(agent.id);
        router.refresh();
      } catch {
        setAgents((prev) => [...prev, agent]);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        });
      }
    },
    [session?.accessToken, router],
  );

  const columns = useMemo<DataTableColumn<Agent>[]>(
    () => [
      {
        header: "Name",
        key: "name",
        render: (agent) => (
          <div>
            <p className="font-medium">{agent.name}</p>
            <p className="text-sm text-muted-foreground">
              {agent.description || "No description"}
            </p>
            <p
              className="mt-0.5 font-mono text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors"
              title="Click to copy agent ID"
              onClick={async (e) => {
                e.stopPropagation();
                await navigator.clipboard.writeText(agent.id);
              }}
            >
              {agent.id}
            </p>
          </div>
        ),
        sortable: true,
        sortValue: (agent) => agent.name,
      },
      {
        header: "Type",
        key: "agent_type",
        render: (agent) => agent.agent_type,
        sortable: true,
        sortValue: (agent) => agent.agent_type,
      },
      {
        header: "Tools",
        key: "tool_allowlist",
        render: (agent) => (
          <div className="flex flex-wrap gap-1">
            {(agent.tool_allowlist ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">all</span>
            ) : (
              (agent.tool_allowlist ?? []).slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))
            )}
            {(agent.tool_allowlist ?? []).length > 3 && (
              <Badge variant="outline" className="text-[10px]">
                +{(agent.tool_allowlist ?? []).length - 3}
              </Badge>
            )}
          </div>
        ),
      },
      {
        header: "Status",
        key: "status",
        render: (agent) => <StatusBadge status={agent.status} />,
        sortable: true,
        sortValue: (agent) => agent.status,
      },
      {
        header: "Created",
        key: "created_at",
        render: (agent) => formatDateTime(agent.created_at),
        sortable: true,
        sortValue: (agent) => agent.created_at,
      },
      {
        className: "w-[180px]",
        header: "Actions",
        key: "actions",
        render: (agent) => {
          const busy = busyIds.has(agent.id);
          const enabled = agent.status !== "disabled";
          return (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title={enabled ? "Disable agent" : "Enable agent"}
                disabled={!canManage || busy}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleEnabled(agent);
                }}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Power
                    className={`size-4 ${enabled ? "text-green-500" : "text-muted-foreground"}`}
                  />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Edit agent"
                disabled={!canManage || busy}
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(agent);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Copy agent ID"
                onClick={async (e) => {
                  e.stopPropagation();
                  await navigator.clipboard.writeText(agent.id);
                }}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Delete agent"
                disabled={!canManage || busy}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAgent(agent);
                }}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          );
        },
      },
    ],
    [busyIds, canManage, deleteAgent, toggleEnabled],
  );

  // ── create handler ───────────────────────────────────────────────────────

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken) {
      setCreateError("No active session token was found.");
      return;
    }
    const model_policy = Object.fromEntries(
      createPolicyRows.filter(([k, v]) => k.trim() && v.trim()),
    );
    try {
      setCreateError(null);
      setCreateSubmitting(true);
      await createApiClient(session.accessToken).agents.create({
        ...createForm,
        model_policy,
      });
      setCreateForm(blankCreateForm);
      setCreatePolicyRows([]);
      setCreateOpen(false);
      router.refresh();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create agent.",
      );
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ── edit handler ─────────────────────────────────────────────────────────

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken || !editTarget) return;
    const model_policy = Object.fromEntries(
      editPolicyRows.filter(([k, v]) => k.trim() && v.trim()),
    );
    try {
      setEditError(null);
      setEditSubmitting(true);
      await createApiClient(session.accessToken).agents.update(editTarget.id, {
        ...editForm,
        model_policy,
      });
      setEditTarget(null);
      router.refresh();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to update agent.",
      );
    } finally {
      setEditSubmitting(false);
    }
  }

  // ── shared form sections ─────────────────────────────────────────────────

  function renderToolPicker(
    allowlist: string[],
    setAllowlist: (v: string[]) => void,
  ) {
    return (
      <div className="space-y-2 text-sm font-medium">
        <span>Tool allowlist</span>
        <p className="text-xs font-normal text-muted-foreground">
          Leave all unchecked to allow all tools.
        </p>
        <ToolPicker selected={allowlist} onChange={setAllowlist} />
      </div>
    );
  }

  function renderPolicyEditor(
    rows: [string, string][],
    setRows: (r: [string, string][]) => void,
  ) {
    return (
      <div className="space-y-2 text-sm font-medium">
        <span>Model policy</span>
        <p className="text-xs font-normal text-muted-foreground">
          Map task types to specific models (e.g. <code>coding → gpt-4o</code>).
        </p>
        <PolicyEditor rows={rows} onChange={setRows} />
      </div>
    );
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Review configured agents and create new ones for the Conflux
            runtime.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!canManage}>
          <Plus className="size-4" />
          New Agent
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent registry</CardTitle>
          <CardDescription>
            {canManage
              ? "Create, edit, and manage tenant agents."
              : "You can browse agents, but only admins can manage them."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={agents}
            emptyMessage="No agents available."
          />
        </CardContent>
      </Card>

      {/* ── Create modal ── */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <Card className="my-4 w-full max-w-2xl">
            <CardHeader>
              <CardTitle>Create agent</CardTitle>
              <CardDescription>Spin up a new managed agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>Name</span>
                    <Input
                      required
                      value={createForm.name}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>Type</span>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={createForm.agent_type}
                      onChange={(e) =>
                        setCreateForm((p) => ({
                          ...p,
                          agent_type: e.target.value,
                        }))
                      }
                    >
                      <option value="worker">Worker</option>
                      <option value="orchestrator">Orchestrator</option>
                      <option value="planner">Planner</option>
                      <option value="coordinator">Coordinator</option>
                    </select>
                  </label>
                </div>
                <label className="space-y-2 text-sm font-medium">
                  <span>Description</span>
                  <Input
                    value={createForm.description ?? ""}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  <span>System prompt</span>
                  <Textarea
                    required
                    value={createForm.system_prompt}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        system_prompt: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  <span>Max iterations</span>
                  <Input
                    min={1}
                    type="number"
                    value={createForm.max_iterations}
                    onChange={(e) =>
                      setCreateForm((p) => ({
                        ...p,
                        max_iterations: Number(e.target.value) || 20,
                      }))
                    }
                  />
                </label>
                {renderToolPicker(createForm.tool_allowlist ?? [], (v) =>
                  setCreateForm((p) => ({ ...p, tool_allowlist: v })),
                )}
                {renderPolicyEditor(createPolicyRows, setCreatePolicyRows)}
                {createError ? (
                  <p className="text-sm text-destructive">{createError}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setCreateError(null);
                      setCreatePolicyRows([]);
                      setCreateOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSubmitting}>
                    {createSubmitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Create agent
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Edit modal ── */}
      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <Card className="my-4 w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Edit agent — {editTarget.name}</CardTitle>
                  <CardDescription>
                    Update this agent's configuration.
                  </CardDescription>
                </div>
                {/* Enable / disable toggle */}
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-sm font-medium text-muted-foreground">
                    {(editForm.is_enabled ?? true) ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editForm.is_enabled ?? true}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                      (editForm.is_enabled ?? true)
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                    onClick={() =>
                      setEditForm((p) => ({
                        ...p,
                        is_enabled: !(p.is_enabled ?? true),
                      }))
                    }
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        (editForm.is_enabled ?? true)
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleEdit}>
                <label className="space-y-2 text-sm font-medium">
                  <span>Name</span>
                  <Input
                    required
                    value={editForm.name ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  <span>Description</span>
                  <Input
                    value={editForm.description ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  <span>System prompt</span>
                  <Textarea
                    rows={5}
                    value={editForm.system_prompt ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        system_prompt: e.target.value,
                      }))
                    }
                  />
                </label>
                {renderToolPicker(editForm.tool_allowlist ?? [], (v) =>
                  setEditForm((p) => ({ ...p, tool_allowlist: v })),
                )}
                {session?.accessToken ? (
                  <AgentMcpPanel
                    agentId={editTarget.id}
                    accessToken={session.accessToken}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Sign in again to manage MCP server assignments.
                  </div>
                )}
                {renderPolicyEditor(editPolicyRows, setEditPolicyRows)}
                {editError ? (
                  <p className="text-sm text-destructive">{editError}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditTarget(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editSubmitting}>
                    {editSubmitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Save changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
