"use client";

import {
  Bot,
  CheckCircle,
  Circle,
  Edit,
  Hash,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DiscordStatus {
  connected: boolean;
  bot_name: string | null;
  bot_id: string | null;
  guild_count: number;
  latency_ms: number | null;
}

interface ChannelMapping {
  channel_id: string;
  channel_name: string;
  agent_id: string;
  agent_name?: string;
}

interface GuildConfig {
  id: string;
  guild_id: string;
  guild_name: string;
  allowed_role_ids: string[];
  notification_channel_id: string | null;
  thread_mode: boolean;
  channel_agent_map: Record<string, string>;
  default_agent_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EditGuildState {
  guild_name: string;
  allowed_role_ids: string;
  notification_channel_id: string;
  thread_mode: boolean;
  default_agent_id: string;
  channel_mappings: ChannelMapping[];
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function DiscordPage() {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [guilds, setGuilds] = useState<GuildConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editGuild, setEditGuild] = useState<GuildConfig | null>(null);
  const [editState, setEditState] = useState<EditGuildState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteGuild, setDeleteGuild] = useState<GuildConfig | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newChannelId, setNewChannelId] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newAgentId, setNewAgentId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g] = await Promise.all([
        apiFetch("/api/admin/discord/status"),
        apiFetch("/api/admin/discord/guilds"),
      ]);
      setStatus(s as DiscordStatus);
      setGuilds(g as GuildConfig[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(guild: GuildConfig) {
    setEditGuild(guild);
    setEditState({
      guild_name: guild.guild_name,
      allowed_role_ids: (guild.allowed_role_ids || []).join(", "),
      notification_channel_id: guild.notification_channel_id || "",
      thread_mode: guild.thread_mode,
      default_agent_id: guild.default_agent_id || "",
      channel_mappings: Object.entries(guild.channel_agent_map || {}).map(
        ([ch_id, ag_id]) => ({
          channel_id: ch_id,
          channel_name: "",
          agent_id: ag_id,
        })
      ),
    });
  }

  async function saveEdit() {
    if (!editGuild || !editState) return;
    setSaving(true);
    try {
      const channel_agent_map: Record<string, string> = {};
      for (const m of editState.channel_mappings) {
        if (m.channel_id && m.agent_id) {
          channel_agent_map[m.channel_id.trim()] = m.agent_id.trim();
        }
      }
      const body = {
        guild_name: editState.guild_name,
        allowed_role_ids: editState.allowed_role_ids
          ? editState.allowed_role_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        notification_channel_id: editState.notification_channel_id || null,
        thread_mode: editState.thread_mode,
        default_agent_id: editState.default_agent_id || null,
        channel_agent_map,
      };
      await apiFetch(`/api/admin/discord/guilds/${editGuild.guild_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditGuild(null);
      setEditState(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteGuild) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/discord/guilds/${deleteGuild.guild_id}`, { method: "DELETE" });
      setDeleteGuild(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function addChannelMapping() {
    if (!editState || !newChannelId || !newAgentId) return;
    setEditState({
      ...editState,
      channel_mappings: [
        ...editState.channel_mappings,
        { channel_id: newChannelId, channel_name: newChannelName, agent_id: newAgentId },
      ],
    });
    setNewChannelId("");
    setNewChannelName("");
    setNewAgentId("");
  }

  function removeChannelMapping(idx: number) {
    if (!editState) return;
    setEditState({
      ...editState,
      channel_mappings: editState.channel_mappings.filter((_, i) => i !== idx),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discord Bot</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the Conflux Discord bot, guild configurations, and channel-to-agent mappings.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Bot Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-indigo-500" />
            <div>
              <CardTitle className="text-base">Bot Connection</CardTitle>
              <CardDescription>Discord Gateway status</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : status ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Status</p>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {status.connected ? (
                    <>
                      <CheckCircle className="size-4 text-green-500" />
                      Online
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 text-red-500" />
                      Offline
                    </>
                  )}
                </div>
              </div>
              {status.bot_name && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Bot</p>
                  <p className="text-sm font-medium">{status.bot_name}</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Servers</p>
                <p className="text-sm font-medium">{status.guild_count}</p>
              </div>
              {status.latency_ms != null && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Latency</p>
                  <p className="text-sm font-medium">{status.latency_ms} ms</p>
                </div>
              )}
            </div>
          ) : null}
          {!loading && !status?.connected && (
            <p className="mt-3 text-xs text-muted-foreground">
              Add your Discord Bot Token in{" "}
              <strong>Admin → System Settings → Messaging</strong> to enable the bot.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Guild Configurations */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Server Configurations</CardTitle>
              <CardDescription>
                Per-Discord-server (guild) settings — roles, agents, thread mode, notifications.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : guilds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No servers configured yet. Invite the bot to a Discord server and it will appear here
              automatically. You can then configure it below.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>Threads</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Channels Mapped</TableHead>
                  <TableHead>Notifications</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {guilds.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <div className="font-medium">{g.guild_name}</div>
                      <div className="text-xs text-muted-foreground">{g.guild_id}</div>
                    </TableCell>
                    <TableCell>
                      {g.thread_mode ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle className="size-3" /> On
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Circle className="size-3" /> Off
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {(g.allowed_role_ids || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">All members</span>
                      ) : (
                        <Badge variant="secondary">
                          <Shield className="mr-1 size-3" />
                          {g.allowed_role_ids.length} role{g.allowed_role_ids.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {Object.keys(g.channel_agent_map || {}).length}
                      </span>
                    </TableCell>
                    <TableCell>
                      {g.notification_channel_id ? (
                        <div className="flex items-center gap-1 text-xs">
                          <Hash className="size-3" />
                          {g.notification_channel_id}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => openEdit(g)}
                        >
                          <Edit className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteGuild(g)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bot Usage Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Using the Bot</CardTitle>
              <CardDescription>Slash commands and invocation methods</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { cmd: "/ask message", desc: "Send a message to your assigned agent" },
              { cmd: "/link api_key", desc: "Link your Conflux account via API key" },
              { cmd: "/unlink", desc: "Unlink your Conflux account" },
              { cmd: "/new", desc: "Start a fresh conversation (clear history)" },
              { cmd: "/me", desc: "Show your linked account and active agent" },
              { cmd: "/agents", desc: "List all available agents" },
              { cmd: "/status", desc: "Check bot and server configuration" },
              { cmd: "@Conflux …", desc: "Mention the bot in any channel to trigger it" },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="flex items-start gap-2 rounded-md border p-2.5">
                <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{cmd}</code>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/30">
            <strong className="text-indigo-700 dark:text-indigo-300">Admin commands</strong>
            <span className="ml-1 text-indigo-600 dark:text-indigo-400">
              (requires Discord server administrator): <code>/config set-role</code>,{" "}
              <code>/config set-agent</code>, <code>/config set-notify</code>,{" "}
              <code>/config thread-mode</code>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Edit Guild Dialog */}
      <Dialog open={!!editGuild} onOpenChange={(o) => !o && setEditGuild(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure: {editGuild?.guild_name}</DialogTitle>
            <DialogDescription>
              Adjust role access, agent assignments, thread mode, and notifications for this server.
            </DialogDescription>
          </DialogHeader>
          {editState && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Server Name</Label>
                <Input
                  value={editState.guild_name}
                  onChange={(e) => setEditState({ ...editState, guild_name: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Thread Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Each conversation creates a new thread
                  </p>
                </div>
                <Switch
                  checked={editState.thread_mode}
                  onCheckedChange={(v) => setEditState({ ...editState, thread_mode: v })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Allowed Role IDs</Label>
                <Input
                  placeholder="Role snowflake IDs, comma-separated (leave empty for all members)"
                  value={editState.allowed_role_ids}
                  onChange={(e) => setEditState({ ...editState, allowed_role_ids: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Find role IDs in Discord: Server Settings → Roles → right-click → Copy ID (with Developer Mode on)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Notification Channel ID</Label>
                <Input
                  placeholder="Discord channel snowflake ID"
                  value={editState.notification_channel_id}
                  onChange={(e) =>
                    setEditState({ ...editState, notification_channel_id: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Proactive notifications (run completions, alerts) will be posted here.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Default Agent ID</Label>
                <Input
                  placeholder="Conflux agent UUID (used when no channel mapping matches)"
                  value={editState.default_agent_id}
                  onChange={(e) =>
                    setEditState({ ...editState, default_agent_id: e.target.value })
                  }
                />
              </div>

              {/* Channel → Agent Mappings */}
              <div className="space-y-2">
                <Label>Channel → Agent Mappings</Label>
                {editState.channel_mappings.length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="py-2 text-xs">Channel ID</TableHead>
                          <TableHead className="py-2 text-xs">Agent ID</TableHead>
                          <TableHead className="w-8 py-2" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {editState.channel_mappings.map((m, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-1 font-mono text-xs">{m.channel_id}</TableCell>
                            <TableCell className="py-1 font-mono text-xs">
                              {m.agent_id.length > 18 ? m.agent_id.slice(0, 8) + "…" : m.agent_id}
                            </TableCell>
                            <TableCell className="py-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-destructive"
                                onClick={() => removeChannelMapping(i)}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <Input
                    placeholder="Channel ID"
                    value={newChannelId}
                    onChange={(e) => setNewChannelId(e.target.value)}
                    className="text-xs"
                  />
                  <Input
                    placeholder="Agent UUID"
                    value={newAgentId}
                    onChange={(e) => setNewAgentId(e.target.value)}
                    className="text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addChannelMapping}
                    disabled={!newChannelId || !newAgentId}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Map a Discord channel (by ID) to a specific Conflux agent. Users in that channel will always use the mapped agent.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGuild(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteGuild} onOpenChange={(o) => !o && setDeleteGuild(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Server Configuration</DialogTitle>
            <DialogDescription>
              Remove the configuration for <strong>{deleteGuild?.guild_name}</strong>? The bot will
              still work but all role/agent/notification settings will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGuild(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
