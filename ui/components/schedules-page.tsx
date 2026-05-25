"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Play,
  Plus,
  ToggleLeft,
  ToggleRight,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createApiClient, type ScheduledTask, type ScheduledTaskCreate } from "@/lib/api";

interface Agent {
  id: string;
  name: string;
}

interface SchedulesPageProps {
  schedules: ScheduledTask[];
  agents: Agent[];
  isAdmin: boolean;
}

const CHANNEL_OPTIONS = [
  { value: "api", label: "API (no delivery)" },
  { value: "telegram", label: "Telegram" },
];

function formatNextRun(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  return `in ${Math.floor(diffHr / 24)}d`;
}

function formatLastRun(dt: string | null): string {
  if (!dt) return "Never";
  const d = new Date(dt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

const defaultForm: ScheduledTaskCreate = {
  name: "",
  agent_id: "",
  schedule: "",
  channel: "api",
  enabled: true,
  input_template: {},
};

export function SchedulesPage({ schedules: initial, agents, isAdmin }: SchedulesPageProps) {
  const { data: session } = useSession();
  const [schedules, setSchedules] = useState<ScheduledTask[]>(initial);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [editTarget, setEditTarget] = useState<ScheduledTask | null>(null);
  const [form, setForm] = useState<ScheduledTaskCreate>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function getClient() {
    return createApiClient((session as { accessToken?: string })?.accessToken);
  }

  function resetForm() {
    setForm(defaultForm);
    setEditTarget(null);
    setError(null);
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(s: ScheduledTask) {
    setEditTarget(s);
    setForm({
      name: s.name,
      agent_id: s.agent_id,
      schedule: s.nl_schedule ?? s.schedule,
      channel: s.channel,
      enabled: s.enabled,
      input_template: s.input_template,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.agent_id || !form.schedule.trim()) {
      setError("Name, agent, and schedule are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const client = getClient();
      if (editTarget) {
        const updated = await client.schedules.update(editTarget.id, form);
        setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSuccess("Schedule updated.");
      } else {
        const created = await client.schedules.create(form);
        setSchedules((prev) => [created, ...prev]);
        setSuccess("Schedule created.");
      }
      setFormOpen(false);
      resetForm();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await getClient().schedules.delete(deleteTarget.id);
      setSchedules((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
      setSuccess("Schedule deleted.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(s: ScheduledTask) {
    try {
      const updated = await getClient().schedules.update(s.id, { enabled: !s.enabled });
      setSchedules((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      setError("Failed to toggle schedule.");
    }
  }

  async function handleRunNow(s: ScheduledTask) {
    setRunningId(s.id);
    setError(null);
    try {
      await getClient().schedules.runNow(s.id);
      setSuccess(`Schedule "${s.name}" triggered.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to trigger run.");
    } finally {
      setRunningId(null);
    }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Automate agent runs on a cron schedule or natural-language trigger.
          </p>
        </div>
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 size-4" />
              New Schedule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editTarget ? "Edit Schedule" : "New Schedule"}</DialogTitle>
              <DialogDescription>
                Use a cron expression (e.g. <code>0 9 * * 1-5</code>) or plain English (e.g.
                &quot;every weekday at 9am EST&quot;).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {error && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  placeholder="Daily briefing"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Agent</Label>
                <Select
                  value={form.agent_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, agent_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select agent…" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Schedule</Label>
                <Input
                  placeholder="every weekday at 9am EST  OR  0 14 * * 1-5"
                  value={form.schedule}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Natural language or 5-field cron expression.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Delivery Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Input Template{" "}
                  <span className="text-xs text-muted-foreground">(optional JSON)</span>
                </Label>
                <Textarea
                  placeholder='{"messages": [{"role": "user", "content": "Generate a daily summary."}]}'
                  rows={3}
                  value={
                    Object.keys(form.input_template ?? {}).length
                      ? JSON.stringify(form.input_template, null, 2)
                      : ""
                  }
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value ? JSON.parse(e.target.value) : {};
                      setForm((f) => ({ ...f, input_template: parsed }));
                    } catch {
                      // let user keep typing
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editTarget ? "Save Changes" : "Create Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Success banner */}
      {success && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {schedules.length} schedule{schedules.length !== 1 ? "s" : ""}
          </CardTitle>
          <CardDescription>
            Schedules run automatically. Use &quot;Run Now&quot; to trigger immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <Clock className="size-10 opacity-30" />
              <p className="text-sm">No schedules yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Runs</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id} className="border-b last:border-0">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {s.enabled ? (
                            <span className="size-2 rounded-full bg-green-500" />
                          ) : (
                            <span className="size-2 rounded-full bg-muted-foreground/40" />
                          )}
                          {s.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {agentName(s.agent_id)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <code className="rounded bg-muted px-1 py-0.5 text-xs">{s.schedule}</code>
                          {s.nl_schedule && (
                            <span className="text-xs text-muted-foreground">{s.nl_schedule}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {s.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatNextRun(s.next_run)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatLastRun(s.last_run)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {s.run_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={s.enabled ? "Disable" : "Enable"}
                            onClick={() => handleToggle(s)}
                          >
                            {s.enabled ? (
                              <ToggleRight className="size-4 text-green-500" />
                            ) : (
                              <ToggleLeft className="size-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Run now"
                            disabled={runningId === s.id}
                            onClick={() => handleRunNow(s)}
                          >
                            {runningId === s.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Play className="size-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Schedule</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
