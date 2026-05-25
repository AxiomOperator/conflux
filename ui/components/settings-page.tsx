"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PersonaFiles } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// File editor tabs
// ---------------------------------------------------------------------------

const FILE_TABS: {
  key: keyof PersonaFiles;
  label: string;
  description: string;
  placeholder: string;
}[] = [
  {
    key: "agents_md",
    label: "AGENTS.md",
    description:
      "Operating instructions for the agent — rules, priorities, and how to behave. Loaded at the start of every session.",
    placeholder:
      "# Operating Instructions\n\n## Principles\n- Be autonomous and decisive...",
  },
  {
    key: "soul_md",
    label: "SOUL.md",
    description:
      "Persona, tone, and boundaries. Defines how the agent presents itself.",
    placeholder: "# Persona\n\n## Tone\n- Direct and concise...",
  },
  {
    key: "user_md",
    label: "USER.md",
    description: "Who you are and how the agent should address you.",
    placeholder: "# About Me\n\nName: ...\nRole: ...\nPreferences: ...",
  },
  {
    key: "identity_md",
    label: "IDENTITY.md",
    description:
      "The agent's name, vibe, and emoji. Created/updated during bootstrap.",
    placeholder:
      "# Identity\n\nName: Conflux\nEmoji: 🧠\nVibe: Autonomous, intelligent",
  },
  {
    key: "tools_md",
    label: "TOOLS.md",
    description:
      "Notes about your local tools and conventions. Guidance only — does not control tool availability.",
    placeholder:
      "# Tool Conventions\n\n## web_search\n- Prefer SearXNG results...",
  },
  {
    key: "heartbeat_md",
    label: "HEARTBEAT.md",
    description:
      "Optional checklist for heartbeat runs. Keep it short to avoid token burn.",
    placeholder:
      "# Heartbeat Checklist\n\n- [ ] Check memory for stale entries\n- [ ] Review pending tasks",
  },
  {
    key: "boot_md",
    label: "BOOT.md",
    description:
      "Optional startup checklist run on gateway restart. Keep it short.",
    placeholder:
      "# Boot Checklist\n\n- [ ] Greet the user\n- [ ] Check for urgent tasks",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";

function FileEditor({
  fileKey,
  description,
  placeholder,
  initialValue,
}: {
  fileKey: keyof PersonaFiles;
  description: string;
  placeholder: string;
  initialValue: string;
}) {
  const [content, setContent] = useState(initialValue);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/users/me/persona", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fileKey]: content }),
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }, [fileKey, content]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      <Textarea
        className="min-h-[400px] resize-y font-mono text-sm"
        placeholder={placeholder}
        value={content ?? ""}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        {saveState === "error" && (
          <span className="text-sm text-destructive">
            Save failed — try again
          </span>
        )}
        <Button
          onClick={handleSave}
          disabled={saveState === "saving"}
          size="sm"
          variant={saveState === "saved" ? "outline" : "default"}
        >
          {saveState === "saving" ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving…
            </>
          ) : saveState === "saved" ? (
            <>
              <Check className="mr-2 size-4 text-green-500" />
              Saved
            </>
          ) : (
            <>
              <Save className="mr-2 size-4" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API key management
// ---------------------------------------------------------------------------

interface ApiKey {
  id: string;
  name: string;
  created_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
}

interface NewKeyResult {
  id: string;
  name: string;
  key: string;
  note: string;
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function ApiKeySection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [expiresDays, setExpiresDays] = useState<string>("never");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("/api");

  useEffect(() => {
    setBaseUrl(`${window.location.origin}/api`);
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/users/me/api-keys");
      if (res.ok) {
        const data = (await res.json()) as ApiKey[];
        setKeys(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadKeys(); }, [loadKeys]);

  const handleCreate = useCallback(async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body: { name: string; expires_days?: number } = { name: newKeyName.trim() };
      if (expiresDays !== "never") body.expires_days = parseInt(expiresDays, 10);
      const res = await fetch("/api/users/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as NewKeyResult & { detail?: string };
      if (!res.ok) {
        setCreateError(data.detail ?? "Failed to create key");
        return;
      }
      setNewKeyResult(data);
      setNewKeyName("");
      setExpiresDays("never");
      void loadKeys();
    } catch {
      setCreateError("Failed to create key");
    } finally {
      setCreating(false);
    }
  }, [newKeyName, expiresDays, loadKeys]);

  const handleRevoke = useCallback(async (keyId: string) => {
    setRevoking(keyId);
    try {
      await fetch(`/api/users/me/api-keys/${keyId}`, { method: "DELETE" });
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } finally {
      setRevoking(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* New key revealed */}
      {newKeyResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
          <div className="mb-1 flex items-center gap-2">
            <Check className="size-4 text-green-600 dark:text-green-400" />
            <p className="font-medium text-green-800 dark:text-green-300">
              API key created — copy it now
            </p>
            <button
              className="ml-auto text-green-700 hover:text-green-900 dark:text-green-400"
              onClick={() => setNewKeyResult(null)}
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mb-2 text-xs text-green-700 dark:text-green-400">
            {newKeyResult.note}
          </p>
          <div className="flex items-center gap-2 rounded bg-white px-3 py-2 font-mono text-sm dark:bg-black/30">
            <span className="flex-1 select-all break-all">
              {showKey ? newKeyResult.key : "•".repeat(40)}
            </span>
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide" : "Reveal"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            <CopyInline text={newKeyResult.key} />
          </div>
        </div>
      )}

      {/* Create form */}
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Create new key</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              placeholder="e.g. My automation script"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="key-expiry">Expiry</Label>
            <Select value={expiresDays} onValueChange={setExpiresDays}>
              <SelectTrigger id="key-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never expires</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">1 year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {createError && (
          <p className="text-sm text-destructive">{createError}</p>
        )}
        <Button
          disabled={!newKeyName.trim() || creating}
          onClick={handleCreate}
          size="sm"
        >
          {creating ? (
            <><Loader2 className="mr-2 size-4 animate-spin" />Creating…</>
          ) : (
            <><Plus className="mr-2 size-4" />Create key</>
          )}
        </Button>
      </div>

      {/* Keys list */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />Loading…
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No API keys yet. Create one above to access Conflux programmatically.
          </p>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {formatDateTime(key.created_at)}
                  {key.last_used_at && (
                    <> · Last used {formatDateTime(key.last_used_at)}</>
                  )}
                  {key.expires_at && (
                    <> · Expires {formatDateTime(key.expires_at)}</>
                  )}
                </p>
              </div>
              <Button
                className="shrink-0"
                disabled={revoking === key.id}
                onClick={() => void handleRevoke(key.id)}
                size="sm"
                variant="ghost"
              >
                {revoking === key.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4 text-destructive" />
                )}
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Usage hint */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How to use</p>
        <p>Include your key in API requests via the <code className="rounded bg-muted px-1">Authorization</code> header:</p>
        <pre className="mt-1 rounded bg-muted px-2 py-1 font-mono">Authorization: Bearer &lt;your-key&gt;</pre>
        <p>Base URL: <code className="rounded bg-muted px-1">{baseUrl}</code></p>
      </div>

      {/* Telegram linking hint */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/40 space-y-1">
        <p className="font-medium text-blue-900 dark:text-blue-200">🤖 Link Telegram</p>
        <p className="text-blue-800 dark:text-blue-300">
          To chat with your agent via Telegram, create an API key above then send this command to the Conflux bot:
        </p>
        <pre className="mt-1 rounded bg-blue-100 px-2 py-1 font-mono text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">/link &lt;your-api-key&gt;</pre>
        <p className="text-blue-700 dark:text-blue-400">
          Once linked, every Telegram message will run through your full agent loop just like the web chat.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------

export function SettingsPage({ persona }: { persona: PersonaFiles }) {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Configure your personal agent's identity, behavior, operating
          instructions, and API access.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Persona Files</CardTitle>
          <CardDescription>
            Each file controls a different aspect of how your agent thinks and
            communicates. Changes take effect on the next agent run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="agents_md">
            <TabsList className="mb-4 h-auto flex-wrap gap-1">
              {FILE_TABS.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {FILE_TABS.map((tab) => (
              <TabsContent key={tab.key} value={tab.key}>
                <FileEditor
                  fileKey={tab.key}
                  description={tab.description}
                  placeholder={tab.placeholder}
                  initialValue={persona[tab.key] ?? ""}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            API Keys
          </CardTitle>
          <CardDescription>
            Create and manage API keys to access Conflux programmatically.
            Keys are shown only once — store them securely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeySection />
        </CardContent>
      </Card>
    </div>
  );
}
