"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Edit2,
  Loader2,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type ToolRecord } from "@/lib/api";

// ─── helpers ────────────────────────────────────────────────────────────────

const RISK_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  safe: {
    label: "Safe",
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    icon: <ShieldCheck className="size-3" />,
  },
  moderate: {
    label: "Moderate",
    color: "bg-amber-500/10 text-amber-600 border-amber-200",
    icon: <Shield className="size-3" />,
  },
  destructive: {
    label: "Destructive",
    color: "bg-red-500/10 text-red-600 border-red-200",
    icon: <ShieldAlert className="size-3" />,
  },
};

function RiskBadge({ level }: { level: string }) {
  const meta = RISK_META[level] ?? RISK_META.safe;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ─── Edit built-in override modal ───────────────────────────────────────────

function EditToolModal({
  tool,
  open,
  onClose,
  onSave,
}: {
  tool: ToolRecord;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descOverride, setDescOverride] = useState(tool.description_override ?? "");
  const [riskLevel, setRiskLevel] = useState(tool.risk_level);
  const [requiresApproval, setRequiresApproval] = useState(tool.requires_approval);

  // Reset state when tool changes
  useEffect(() => {
    setDescOverride(tool.description_override ?? "");
    setRiskLevel(tool.risk_level);
    setRequiresApproval(tool.requires_approval);
    setError(null);
  }, [tool]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/v1/tools/${encodeURIComponent(tool.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description_override: descOverride.trim() || null,
          risk_level: riskLevel,
          requires_approval: requiresApproval,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4" />
            Edit tool: {tool.name}
          </DialogTitle>
          <DialogDescription>
            Override built-in defaults. Leave description blank to use the original.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label>Description override</Label>
            {tool.original_description && tool.original_description !== tool.description && (
              <p className="text-xs text-muted-foreground">
                Original: {tool.original_description}
              </p>
            )}
            <Textarea
              rows={3}
              placeholder="Leave blank to use original description"
              value={descOverride}
              onChange={(e) => setDescOverride(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Risk level</Label>
            <Select value={riskLevel} onValueChange={setRiskLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">Safe</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="destructive">Destructive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Requires approval</Label>
              <p className="text-xs text-muted-foreground">
                Pauses execution until an admin approves this tool call
              </p>
            </div>
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add custom webhook tool modal ──────────────────────────────────────────

const DEFAULT_PARAMS = JSON.stringify(
  { type: "object", properties: {}, required: [] },
  null,
  2,
);

function AddToolModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [riskLevel, setRiskLevel] = useState("moderate");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState("POST");
  const [headersJson, setHeadersJson] = useState("{}");
  const [paramsJson, setParamsJson] = useState(DEFAULT_PARAMS);

  function reset() {
    setName(""); setDescription(""); setRiskLevel("moderate");
    setRequiresApproval(false); setEndpointUrl(""); setHttpMethod("POST");
    setHeadersJson("{}"); setParamsJson(DEFAULT_PARAMS); setError(null);
  }

  async function handleCreate() {
    if (!name.trim() || !description.trim() || !endpointUrl.trim()) {
      setError("Name, description, and endpoint URL are required.");
      return;
    }
    let headers: Record<string, string> | null = null;
    let parameters: Record<string, unknown> | null = null;
    try {
      headers = JSON.parse(headersJson) as Record<string, string>;
      parameters = JSON.parse(paramsJson) as Record<string, unknown>;
    } catch {
      setError("Headers and Parameters must be valid JSON.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/v1/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          risk_level: riskLevel,
          requires_approval: requiresApproval,
          endpoint_url: endpointUrl.trim(),
          http_method: httpMethod,
          custom_headers: Object.keys(headers).length ? headers : null,
          custom_parameters: parameters,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tool.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="size-4" />
            Add custom webhook tool
          </DialogTitle>
          <DialogDescription>
            Define a new tool backed by an HTTP endpoint. Agents call this tool
            and Conflux POSTs the arguments to your endpoint.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tool name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. send_email"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/\s/g, "_"))}
              />
              <p className="text-xs text-muted-foreground">snake_case, no spaces</p>
            </div>

            <div className="space-y-1.5">
              <Label>Risk level</Label>
              <Select value={riskLevel} onValueChange={setRiskLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">Safe</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="destructive">Destructive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              placeholder="What does this tool do? The agent uses this to decide when to call it."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Endpoint URL <span className="text-destructive">*</span></Label>
              <Input
                type="url"
                placeholder="https://your-service.example.com/tool"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>HTTP method</Label>
              <Select value={httpMethod} onValueChange={setHttpMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Headers (JSON)</Label>
            <Textarea
              rows={3}
              className="font-mono text-xs"
              value={headersJson}
              onChange={(e) => setHeadersJson(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Parameters schema (JSON Schema)</Label>
            <Textarea
              rows={6}
              className="font-mono text-xs"
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Requires approval</Label>
              <p className="text-xs text-muted-foreground">
                Pause and wait for admin sign-off before executing
              </p>
            </div>
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Create tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tool row ────────────────────────────────────────────────────────────────

function ToolRow({
  tool,
  onEdit,
  onToggle,
  onDelete,
  toggling,
  deleting,
}: {
  tool: ToolRecord;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  toggling: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border transition-colors ${tool.is_enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* expand/collapse params */}
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={expanded ? "Hide parameters" : "Show parameters"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{tool.name}</span>
            <RiskBadge level={tool.risk_level} />
            {tool.is_builtin ? (
              <Badge variant="secondary" className="text-xs">Built-in</Badge>
            ) : (
              <Badge variant="outline" className="text-xs gap-1">
                <Webhook className="size-3" /> Webhook
              </Badge>
            )}
            {tool.requires_approval && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                Needs approval
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {tool.description}
          </p>
          {!tool.is_builtin && tool.endpoint_url && (
            <p className="mt-0.5 text-xs text-muted-foreground font-mono">
              {tool.http_method} {tool.endpoint_url}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* enabled toggle */}
          {toggling ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={tool.is_enabled}
              onCheckedChange={onToggle}
              title={tool.is_enabled ? "Disable tool" : "Enable tool"}
            />
          )}

          {/* edit */}
          <Button
            variant="ghost"
            size="icon"
            title="Edit tool"
            onClick={onEdit}
          >
            <Edit2 className="size-4" />
          </Button>

          {/* delete (custom only) */}
          {!tool.is_builtin && (
            <Button
              variant="ghost"
              size="icon"
              title="Delete custom tool"
              disabled={deleting}
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* expanded parameters view */}
      {expanded && tool.parameters && (
        <div className="border-t px-4 pb-4 pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Parameters schema
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            {JSON.stringify(tool.parameters, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main section component ──────────────────────────────────────────────────

export function ToolsSection({ initialTools }: { initialTools: ToolRecord[] }) {
  const [tools, setTools] = useState<ToolRecord[]>(initialTools);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editTool, setEditTool] = useState<ToolRecord | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all" | "builtin" | "custom">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = tools;
    if (filter === "builtin") list = list.filter((t) => t.is_builtin);
    if (filter === "custom") list = list.filter((t) => !t.is_builtin);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tools, filter, search]);

  async function refreshTools() {
    try {
      const res = await fetch("/v1/tools");
      if (res.ok) {
        const data = (await res.json()) as { tools: ToolRecord[] };
        setTools(data.tools ?? []);
      }
    } catch {
      // ignore refresh errors
    }
  }

  async function handleToggle(tool: ToolRecord) {
    setTogglingId(tool.name);
    setError(null);
    try {
      const res = await fetch(`/v1/tools/${encodeURIComponent(tool.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: !tool.is_enabled }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      await refreshTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tool.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete custom tool "${name}"? This cannot be undone.`)) return;
    setDeletingId(name);
    setError(null);
    try {
      const res = await fetch(`/v1/tools/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      await refreshTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tool.");
    } finally {
      setDeletingId(null);
    }
  }

  const builtinCount = tools.filter((t) => t.is_builtin).length;
  const customCount = tools.filter((t) => !t.is_builtin).length;
  const enabledCount = tools.filter((t) => t.is_enabled).length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Tools</CardTitle>
              <CardDescription>
                {builtinCount} built-in · {customCount} custom · {enabledCount} enabled
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="size-4" />
              Add tool
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          {/* filter + search bar */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex rounded-lg border overflow-hidden text-sm">
              {(["all", "builtin", "custom"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 capitalize transition-colors ${
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <Input
              placeholder="Search tools…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-64"
            />
          </div>

          {/* tool list */}
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No tools match your filter.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  toggling={togglingId === tool.name}
                  deleting={deletingId === tool.name}
                  onToggle={() => void handleToggle(tool)}
                  onEdit={() => setEditTool(tool)}
                  onDelete={() => void handleDelete(tool.name)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editTool && (
        <EditToolModal
          tool={editTool}
          open={!!editTool}
          onClose={() => setEditTool(null)}
          onSave={() => { void refreshTools(); }}
        />
      )}

      <AddToolModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => { void refreshTools(); }}
      />
    </>
  );
}
