"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Server,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useSession } from "next-auth/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { McpServer, McpServerCreate, McpTestResult } from "@/lib/api";
import { createApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

type FeedbackState = {
  message: string;
  tone: "error" | "success";
} | null;

type TransportType = "stdio" | "sse";
type RiskLevel = "safe" | "moderate" | "destructive";

type ServerFormState = {
  name: string;
  description: string;
  transport: TransportType;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  risk_level: RiskLevel;
  is_enabled: boolean;
};

const EMPTY_FORM: ServerFormState = {
  name: "",
  description: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  risk_level: "safe",
  is_enabled: true,
};

const TRANSPORT_BADGE_STYLES: Record<TransportType, string> = {
  stdio: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  sse: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const RISK_BADGE_STYLES: Record<RiskLevel, string> = {
  safe: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  destructive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function sortServers(servers: McpServer[]) {
  return [...servers].sort((left, right) => left.name.localeCompare(right.name));
}

function toKeyValueText(values: Record<string, string> | null | undefined) {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function toArgsText(values: string[] | null | undefined) {
  return (values ?? []).join(", ");
}

function toFormState(server: McpServer): ServerFormState {
  return {
    name: server.name,
    description: server.description ?? "",
    transport: server.transport,
    command: server.command ?? "",
    args: toArgsText(server.args),
    env: toKeyValueText(server.env),
    url: server.url ?? "",
    headers: toKeyValueText(server.headers),
    risk_level: server.risk_level,
    is_enabled: server.is_enabled,
  };
}

function parseArgs(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseKeyValueText(value: string, fieldLabel: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${fieldLabel} must be valid JSON or KEY=VALUE pairs.`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} JSON must be an object.`);
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, entryValue]) => [
        key,
        typeof entryValue === "string" ? entryValue : JSON.stringify(entryValue),
      ]),
    );
  }

  return Object.fromEntries(
    trimmed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          throw new Error(`${fieldLabel} entries must use KEY=VALUE format.`);
        }

        const key = line.slice(0, separatorIndex).trim();
        const entryValue = line.slice(separatorIndex + 1).trim();
        if (!key) {
          throw new Error(`${fieldLabel} entries must include a key before '='.`);
        }
        return [key, entryValue] as const;
      }),
  );
}

function buildPayload(form: ServerFormState): McpServerCreate {
  const name = form.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }

  const payload: McpServerCreate = {
    name,
    description: form.description.trim() || undefined,
    transport: form.transport,
    risk_level: form.risk_level,
    is_enabled: form.is_enabled,
  };

  if (form.transport === "stdio") {
    const command = form.command.trim();
    if (!command) {
      throw new Error("Command is required for stdio servers.");
    }

    payload.command = command;
    payload.args = parseArgs(form.args);
    payload.env = parseKeyValueText(form.env, "Environment variables");
    payload.url = "";
    payload.headers = {};
    return payload;
  }

  const url = form.url.trim();
  if (!url) {
    throw new Error("URL is required for SSE servers.");
  }

  payload.url = url;
  payload.headers = parseKeyValueText(form.headers, "Headers");
  payload.command = "";
  payload.args = [];
  payload.env = {};
  return payload;
}

function FeedbackBanner({ feedback }: { feedback: NonNullable<FeedbackState> }) {
  const isError = feedback.tone === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        isError
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p>{feedback.message}</p>
    </div>
  );
}

export function McpServersPage({
  servers: initialServers,
  isAdmin,
}: {
  servers: McpServer[];
  isAdmin: boolean;
}) {
  const { data: session } = useSession();
  const [servers, setServers] = useState(() => sortServers(initialServers));
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [form, setForm] = useState<ServerFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [testServerName, setTestServerName] = useState<string | null>(null);
  const [testSheetOpen, setTestSheetOpen] = useState(false);
  const [expandedToolName, setExpandedToolName] = useState<string | null>(null);

  function resetForm() {
    setEditingServer(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function openEditDialog(server: McpServer) {
    setEditingServer(server);
    setForm(toFormState(server));
    setFormError(null);
    setFeedback(null);
    setFormOpen(true);
  }

  function closeFormDialog() {
    setFormOpen(false);
    resetForm();
  }

  function getClient() {
    if (!session?.accessToken) {
      throw new Error("No active session token was found.");
    }
    return createApiClient(session.accessToken);
  }

  async function handleSave() {
    try {
      setSaving(true);
      setFormError(null);
      setFeedback(null);
      const payload = buildPayload(form);
      const client = getClient();

      if (editingServer) {
        const updated = await client.mcp.updateServer(editingServer.id, payload);
        setServers((current) =>
          sortServers(current.map((server) => (server.id === updated.id ? updated : server))),
        );
        setFeedback({ message: `Updated ${updated.name}.`, tone: "success" });
      } else {
        const created = await client.mcp.createServer(payload);
        setServers((current) => sortServers([...current, created]));
        setFeedback({ message: `Created ${created.name}.`, tone: "success" });
      }

      closeFormDialog();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save MCP server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeletingId(deleteTarget.id);
      setFeedback(null);
      await getClient().mcp.deleteServer(deleteTarget.id);
      setServers((current) => current.filter((server) => server.id !== deleteTarget.id));
      setFeedback({ message: `Deleted ${deleteTarget.name}.`, tone: "success" });
      setDeleteTarget(null);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Failed to delete MCP server.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTest(server: McpServer) {
    try {
      setTestingId(server.id);
      setFeedback(null);
      setExpandedToolName(null);
      const result = await getClient().mcp.testServer(server.id);
      setTestServerName(server.name);
      setTestResult(result);
      setTestSheetOpen(true);
      setFeedback({
        message:
          result.status === "connected"
            ? `Connected to ${server.name}.`
            : `Connection test for ${server.name} returned an error.`,
        tone: result.status === "connected" ? "success" : "error",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to test MCP server.";
      setTestServerName(server.name);
      setTestResult({ error: message, status: "error", tool_count: 0, tools: [] });
      setTestSheetOpen(true);
      setFeedback({ message, tone: "error" });
    } finally {
      setTestingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP Servers</CardTitle>
          <CardDescription>This section is only available to Conflux administrators.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sign in with an admin account to manage MCP server connectivity and testing.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server className="size-5 text-muted-foreground" />
            <h1 className="text-3xl font-semibold tracking-tight">MCP Servers</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure stdio and SSE MCP servers, then test the tools they expose.
          </p>
        </div>
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) {
              resetForm();
              setFeedback(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              Add MCP Server
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingServer ? `Edit ${editingServer.name}` : "Add MCP Server"}</DialogTitle>
              <DialogDescription>
                Configure how Conflux connects to this server and what level of risk its tools represent.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {formError ? <FeedbackBanner feedback={{ message: formError, tone: "error" }} /> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-name">Name</Label>
                  <Input
                    id="mcp-name"
                    placeholder="filesystem"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-risk-level">Risk Level</Label>
                  <Select
                    value={form.risk_level}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, risk_level: value as RiskLevel }))
                    }
                  >
                    <SelectTrigger id="mcp-risk-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="safe">Safe</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="destructive">Destructive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mcp-description">Description</Label>
                <Textarea
                  id="mcp-description"
                  placeholder="Optional summary for administrators"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Transport</Label>
                <Tabs
                  value={form.transport}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, transport: value as TransportType }))
                  }
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="stdio">stdio</TabsTrigger>
                    <TabsTrigger value="sse">sse</TabsTrigger>
                  </TabsList>
                  <TabsContent value="stdio" className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-command">Command</Label>
                      <Input
                        id="mcp-command"
                        placeholder="npx"
                        value={form.command}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, command: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-args">Args</Label>
                      <Input
                        id="mcp-args"
                        placeholder="-y, @modelcontextprotocol/server-filesystem, /workspace"
                        value={form.args}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, args: event.target.value }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">Comma-separated command arguments.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-env">Environment Variables</Label>
                      <Textarea
                        id="mcp-env"
                        placeholder="API_KEY=secret\nLOG_LEVEL=debug"
                        value={form.env}
                        onChange={(event) => setForm((current) => ({ ...current, env: event.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">Use KEY=VALUE pairs or paste a JSON object.</p>
                    </div>
                  </TabsContent>
                  <TabsContent value="sse" className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-url">URL</Label>
                      <Input
                        id="mcp-url"
                        type="url"
                        placeholder="https://example.com/mcp"
                        value={form.url}
                        onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-headers">Headers</Label>
                      <Textarea
                        id="mcp-headers"
                        placeholder="Authorization=Bearer ...\nX-Tenant=example"
                        value={form.headers}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, headers: event.target.value }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">Use KEY=VALUE pairs or paste a JSON object.</p>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              <div className="flex items-center justify-between rounded-xl border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="mcp-enabled">Enabled</Label>
                  <p className="text-xs text-muted-foreground">Disabled servers stay saved but will not be used.</p>
                </div>
                <Switch
                  id="mcp-enabled"
                  checked={form.is_enabled}
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, is_enabled: checked }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeFormDialog} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {editingServer ? "Save Changes" : "Add MCP Server"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {servers.length > 0 ? (
          servers.map((server) => {
            const isTesting = testingId === server.id;
            const isDeleting = deletingId === server.id;
            return (
              <Card key={server.id}>
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{server.name}</CardTitle>
                      <CardDescription>
                        {server.description || "No description provided for this MCP server."}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Badge className={cn("border-0", TRANSPORT_BADGE_STYLES[server.transport])}>
                        {server.transport}
                      </Badge>
                      <Badge className={cn("border-0", RISK_BADGE_STYLES[server.risk_level])}>
                        {server.risk_level}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          server.is_enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                            : "border-muted-foreground/20 bg-muted text-muted-foreground",
                        )}
                      >
                        {server.is_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {server.transport === "stdio" ? "Command" : "Endpoint"}
                    </p>
                    <p className="break-all font-medium">
                      {server.transport === "stdio"
                        ? server.command || "No command configured."
                        : server.url || "No URL configured."}
                    </p>
                    {server.transport === "stdio" && (server.args ?? []).length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">Args: {(server.args ?? []).join(", ")}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={isTesting}
                      onClick={() => void handleTest(server)}
                    >
                      {isTesting ? <Loader2 className="size-4 animate-spin" /> : <TestTube2 className="size-4" />}
                      Test Connection
                    </Button>
                    <Button variant="outline" onClick={() => openEditDialog(server)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={isDeleting}
                      onClick={() => setDeleteTarget(server)}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Server className="size-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">No MCP servers configured</p>
                <p className="text-sm text-muted-foreground">
                  Add a server to test connectivity and expose remote tool definitions.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Delete ${deleteTarget.name}? This action cannot be undone.`
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingId)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={Boolean(deletingId)}>
              {deletingId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={testSheetOpen} onOpenChange={setTestSheetOpen}>
        <SheetContent side="right" className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Test Connection</SheetTitle>
            <SheetDescription>
              {testServerName ? `Latest connection test for ${testServerName}.` : "Latest MCP test result."}
            </SheetDescription>
          </SheetHeader>

          {testResult ? (
            <div className="mt-6 space-y-4">
              <div
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
                  testResult.status === "connected"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/40 bg-destructive/5 text-destructive",
                )}
              >
                {testResult.status === "connected" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <div className="space-y-1">
                  <p className="font-medium">
                    {testResult.status === "connected" ? "Connected successfully" : "Connection failed"}
                  </p>
                  <p>
                    {testResult.status === "connected"
                      ? `Discovered ${testResult.tool_count} tool${testResult.tool_count === 1 ? "" : "s"}.`
                      : testResult.error || "No additional error details were returned."}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Discovered tools</h2>
                  <Badge variant="outline">{testResult.tool_count}</Badge>
                </div>

                {testResult.tools.length > 0 ? (
                  testResult.tools.map((tool) => {
                    const expanded = expandedToolName === tool.name;
                    return (
                      <div key={`${tool.server_name}:${tool.name}`} className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{tool.name}</p>
                              {tool.original_name !== tool.name ? (
                                <Badge variant="outline">Original: {tool.original_name}</Badge>
                              ) : null}
                              <Badge variant="outline">{tool.server_name}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {tool.description || "No description provided."}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedToolName(expanded ? null : tool.name)}
                          >
                            Parameters
                            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </Button>
                        </div>
                        {expanded ? (
                          <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs leading-6">
                            {JSON.stringify(tool.parameters ?? {}, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      No tools were returned by this server.
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
