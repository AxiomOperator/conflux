"use client";

import {
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, shortId } from "@/lib/format";

interface AgentMailStatus {
  configured: boolean;
}

interface AgentMailInbox {
  created_at?: string;
  display_name?: string;
  email_address: string;
  inbox_id: string;
}

interface AgentMailMessage {
  date?: string;
  from: string;
  message_id: string;
  preview?: string;
  subject: string;
  thread_id?: string;
  to: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function formatAddress(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatAddress(entry))
      .filter(Boolean)
      .join(", ");
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const email =
    asString(record.email) ||
    asString(record.email_address) ||
    asString(record.address);
  const name = asString(record.display_name) || asString(record.name);

  if (name && email) {
    return `${name} <${email}>`;
  }

  return name || email;
}

function normalizeInboxes(payload: unknown): AgentMailInbox[] {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.inboxes)
      ? (asRecord(payload)?.inboxes as unknown[])
      : [];
  const inboxes: AgentMailInbox[] = [];

  for (const entry of values) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const inbox_id = asString(record.inbox_id, asString(record.id));
    const email_address = asString(
      record.email_address,
      asString(record.email),
    );
    if (!inbox_id || !email_address) {
      continue;
    }

    inboxes.push({
      created_at: asString(record.created_at) || undefined,
      display_name: asString(record.display_name) || undefined,
      email_address,
      inbox_id,
    });
  }

  return inboxes;
}

function normalizeMessages(payload: unknown): AgentMailMessage[] {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.messages)
      ? (asRecord(payload)?.messages as unknown[])
      : [];
  const messages: AgentMailMessage[] = [];

  for (const entry of values) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const message_id = asString(record.message_id, asString(record.id));
    if (!message_id) {
      continue;
    }

    messages.push({
      date:
        asString(record.timestamp) ||
        asString(record.created_at) ||
        asString(record.updated_at) ||
        undefined,
      from: formatAddress(record.from ?? record.from_ ?? record.sender) || "—",
      message_id,
      preview: asString(record.preview) || undefined,
      subject: asString(record.subject, "(No subject)"),
      thread_id: asString(record.thread_id) || undefined,
      to: formatAddress(record.to ?? record.recipients) || "—",
    });
  }

  return messages;
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
    message?: string;
  } | null;
  return data?.detail ?? data?.error ?? data?.message ?? fallback;
}

export function AgentMailPage() {
  const [status, setStatus] = useState<AgentMailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [inboxes, setInboxes] = useState<AgentMailInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [selectedInbox, setSelectedInbox] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMailMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedInboxRecord = useMemo(
    () => inboxes.find((inbox) => inbox.inbox_id === selectedInbox) ?? null,
    [inboxes, selectedInbox],
  );

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await fetch("/api/admin/agentmail/status", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load AgentMail status."),
        );
      }

      const data = (await response.json()) as AgentMailStatus;
      setStatus({ configured: Boolean(data?.configured) });
    } catch (fetchError) {
      setStatus(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load AgentMail status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchInboxes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/agentmail/inboxes?limit=100", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load inboxes."),
        );
      }

      const data = (await response.json()) as unknown;
      setInboxes(normalizeInboxes(data));
    } catch (fetchError) {
      setInboxes([]);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load inboxes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (inboxId: string) => {
    setSelectedInbox(inboxId);
    setLoadingMessages(true);
    try {
      const response = await fetch(
        `/api/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}/messages?limit=20`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load messages."),
        );
      }

      const data = (await response.json()) as unknown;
      setMessages(normalizeMessages(data));
    } catch (fetchError) {
      setMessages([]);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load messages.",
      );
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      await Promise.all([fetchStatus(), fetchInboxes()]);
      if (selectedInbox) {
        await loadMessages(selectedInbox);
      }
    } finally {
      setRefreshing(false);
    }
  }, [fetchInboxes, fetchStatus, loadMessages, selectedInbox]);

  useEffect(() => {
    setError(null);
    void Promise.all([fetchStatus(), fetchInboxes()]);
  }, [fetchInboxes, fetchStatus]);

  const createInbox = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/agentmail/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: newDisplayName || undefined,
          username: newUsername || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to create inbox."),
        );
      }

      setNewDisplayName("");
      setNewUsername("");
      await fetchInboxes();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create inbox.",
      );
    } finally {
      setCreating(false);
    }
  }, [fetchInboxes, newDisplayName, newUsername]);

  const deleteInbox = useCallback(
    async (inboxId: string) => {
      if (!confirm("Delete this inbox? All messages will be lost.")) {
        return;
      }

      setDeletingId(inboxId);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}`,
          {
            method: "DELETE",
          },
        );
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, "Failed to delete inbox."),
          );
        }

        await fetchInboxes();
        if (selectedInbox === inboxId) {
          setSelectedInbox(null);
          setMessages([]);
        }
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete inbox.",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [fetchInboxes, selectedInbox],
  );

  const isConfigured = Boolean(status?.configured);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-muted-foreground" />
            <h1 className="text-3xl font-semibold tracking-tight">AgentMail</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage agent inboxes, review recent mail, and verify the integration
            status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConfigured ? "default" : "secondary"}>
            {statusLoading && !status
              ? "Checking…"
              : isConfigured
                ? "Configured"
                : "Not Configured"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="size-4 text-muted-foreground" />
              Integration status
            </CardTitle>
            <CardDescription>
              Conflux uses AgentMail to provision inboxes for agents and inspect
              their conversations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isConfigured ? "default" : "secondary"}>
                {isConfigured ? "Ready" : "Needs configuration"}
              </Badge>
              <span className="text-muted-foreground">
                {statusLoading
                  ? "Checking backend configuration…"
                  : isConfigured
                    ? "The AgentMail admin API is available."
                    : "Add your AgentMail credentials on the backend to enable inbox management."}
              </span>
            </div>
            <ul className="space-y-1 text-muted-foreground">
              <li>• Create dedicated inboxes for agents and workflows.</li>
              <li>• Review the latest received and sent messages.</li>
              <li>• Manage inbox lifecycle without leaving Conflux.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="size-4 text-muted-foreground" />
              AgentMail console
            </CardTitle>
            <CardDescription>
              Use AgentMail’s console to manage domains, API keys, and other
              account-level settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              AgentMail gives AI agents a full email surface area: inbox
              creation, message delivery, thread retrieval, and mailbox
              management from a single API.
            </p>
            <Button asChild variant="outline">
              <a
                href="https://console.agentmail.to"
                target="_blank"
                rel="noreferrer"
              >
                Open AgentMail Console
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      {!statusLoading && !isConfigured ? (
        <Card>
          <CardHeader>
            <CardTitle>AgentMail is not configured</CardTitle>
            <CardDescription>
              Once the backend is configured, administrators can create inboxes
              and inspect recent messages here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {isConfigured ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create inbox</CardTitle>
              <CardDescription>
                Both fields are optional. Leave them blank to let AgentMail
                generate defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agentmail-display-name">Display Name</Label>
                  <Input
                    id="agentmail-display-name"
                    placeholder="Research Agent"
                    value={newDisplayName}
                    onChange={(event) => setNewDisplayName(event.target.value)}
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agentmail-username">Username</Label>
                  <Input
                    id="agentmail-username"
                    placeholder="research-agent"
                    value={newUsername}
                    onChange={(event) => setNewUsername(event.target.value)}
                    disabled={creating}
                  />
                </div>
              </div>
              <Button onClick={() => void createInbox()} disabled={creating}>
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create Inbox
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inboxes</CardTitle>
                <CardDescription>
                  Review all provisioned AgentMail inboxes and open the latest
                  messages.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Inbox ID</TableHead>
                      <TableHead>Email Address</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[220px] text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-8 text-center text-muted-foreground"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="size-4 animate-spin" />
                            Loading inboxes…
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : inboxes.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-muted-foreground"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <Inbox className="size-8" />
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                No inboxes yet
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Create your first AgentMail inbox to start
                                receiving agent email.
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      inboxes.map((inbox) => {
                        const selected = selectedInbox === inbox.inbox_id;
                        return (
                          <TableRow
                            key={inbox.inbox_id}
                            className={selected ? "bg-muted/40" : undefined}
                          >
                            <TableCell>
                              <code className="rounded bg-muted px-2 py-1 text-xs">
                                {shortId(inbox.inbox_id, 12)}
                              </code>
                            </TableCell>
                            <TableCell className="font-medium">
                              {inbox.email_address}
                            </TableCell>
                            <TableCell>{inbox.display_name || "—"}</TableCell>
                            <TableCell>
                              {formatDateTime(inbox.created_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant={selected ? "default" : "outline"}
                                  size="sm"
                                  onClick={() =>
                                    void loadMessages(inbox.inbox_id)
                                  }
                                  disabled={loadingMessages && selected}
                                >
                                  {loadingMessages && selected ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <MessageSquare className="size-4" />
                                  )}
                                  View Messages
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() =>
                                    void deleteInbox(inbox.inbox_id)
                                  }
                                  disabled={deletingId === inbox.inbox_id}
                                >
                                  {deletingId === inbox.inbox_id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-4" />
                                  )}
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent messages</CardTitle>
                <CardDescription>
                  {selectedInboxRecord
                    ? `Last 20 messages for ${selectedInboxRecord.email_address}`
                    : "Select an inbox to inspect its latest messages."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedInboxRecord ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-10 text-center text-muted-foreground">
                    <MessageSquare className="size-10" />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        No inbox selected
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Choose an inbox from the table to view its most recent
                        mail.
                      </p>
                    </div>
                  </div>
                ) : loadingMessages ? (
                  <div className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading messages…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-10 text-center text-muted-foreground">
                    <Inbox className="size-10" />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        No messages found
                      </p>
                      <p className="text-sm text-muted-foreground">
                        This inbox has no recent messages to display.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <div
                        key={message.message_id}
                        className="rounded-xl border p-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <p className="font-medium">{message.subject}</p>
                            <p className="text-sm text-muted-foreground">
                              From: {message.from}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              To: {message.to}
                            </p>
                          </div>
                          <div className="space-y-1 text-right text-xs text-muted-foreground">
                            <p>{formatDateTime(message.date)}</p>
                            {message.thread_id ? (
                              <p>
                                Thread{" "}
                                <span className="font-mono">
                                  {shortId(message.thread_id, 12)}
                                </span>
                              </p>
                            ) : null}
                          </div>
                        </div>
                        {message.preview ? (
                          <p className="mt-3 text-sm text-muted-foreground">
                            {message.preview}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
