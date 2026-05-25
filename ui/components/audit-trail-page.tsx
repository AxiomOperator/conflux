"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ScrollText,
  TerminalSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface AuditEventOut {
  id: string;
  created_at: string;
  event_type: "tool_call" | "shell_command" | "error";
  agent_run_id: string | null;
  user_id: string | null;
  session_id: string | null;
  tool_name: string | null;
  args_preview: string | null;
  result_preview: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

interface AuditPage {
  items: AuditEventOut[];
  total: number;
  page: number;
  page_size: number;
}

type EventTypeFilter = "ALL" | AuditEventOut["event_type"];

interface AuditFilters {
  eventType: EventTypeFilter;
  toolName: string;
  agentRunId: string;
  since: string;
  until: string;
}

const PAGE_SIZE = 20;

const EVENT_BADGE_STYLES: Record<AuditEventOut["event_type"], string> = {
  tool_call:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  shell_command:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  error:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
};

function buildDefaultFilters(): AuditFilters {
  const now = new Date();
  return {
    eventType: "ALL",
    toolName: "",
    agentRunId: "",
    since: toLocalDateTimeValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    until: toLocalDateTimeValue(now),
  };
}

function readErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const payload = data as {
    detail?: unknown;
    error?: unknown;
    message?: unknown;
  };

  if (typeof payload.detail === "string") {
    return payload.detail;
  }
  if (typeof payload.error === "string") {
    return payload.error;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return fallback;
}

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return "—";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function absoluteTime(iso: string) {
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function toLocalDateTimeValue(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function formatDuration(durationMs: number | null) {
  if (durationMs == null) {
    return "—";
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function formatPreview(value: string | null) {
  if (!value || !value.trim()) {
    return "None";
  }
  return value;
}

function eventTypeLabel(eventType: AuditEventOut["event_type"]) {
  switch (eventType) {
    case "tool_call":
      return "Tool Call";
    case "shell_command":
      return "Shell Command";
    case "error":
      return "Error";
  }
}

export function AuditTrailPage() {
  const initialFilters = useMemo(() => buildDefaultFilters(), []);
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchAudit = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const requestId = ++requestIdRef.current;
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(PAGE_SIZE),
        });

        if (appliedFilters.eventType !== "ALL") {
          params.set("event_type", appliedFilters.eventType);
        }
        if (appliedFilters.toolName.trim()) {
          params.set("tool_name", appliedFilters.toolName.trim());
        }
        if (appliedFilters.agentRunId.trim()) {
          params.set("agent_run_id", appliedFilters.agentRunId.trim());
        }
        const since = toIso(appliedFilters.since);
        if (since) {
          params.set("since", since);
        }
        const until = toIso(appliedFilters.until);
        if (until) {
          params.set("until", until);
        }

        const response = await fetch(`/api/admin/audit?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "Failed to load audit trail."));
        }
        if (requestId !== requestIdRef.current) {
          return;
        }

        const nextData = payload as AuditPage;
        setData(nextData);
        setError(null);
        setExpandedEventId((current) =>
          nextData.items.some((event) => event.id === current) ? current : null,
        );
      } catch (fetchError) {
        if (signal?.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load audit trail.",
        );
      } finally {
        if (signal?.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedFilters, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchAudit(controller.signal);
    return () => controller.abort();
  }, [fetchAudit]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchAudit(undefined, true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchAudit]);

  const items = data?.items ?? [];
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const shellCommands = items.filter((event) => event.event_type === "shell_command").length;
  const errors = items.filter((event) => event.event_type === "error").length;
  const toolCalls = items.filter((event) => event.event_type === "tool_call").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <ScrollText className="size-7" />
            Audit Trail
          </h1>
          <p className="text-sm text-muted-foreground">
            Inspect admin audit events, tool execution details, and error records.
          </p>
        </div>
        <Button onClick={() => void fetchAudit(undefined, true)} disabled={loading || refreshing}>
          {loading || refreshing ? (
            <Spinner className="mr-2 size-4" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }, (_, index) => (
              <Card key={index}>
                <CardHeader className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-8 w-24" />
                </CardHeader>
              </Card>
            ))
          : [
              {
                label: "Total Events",
                value: String(data?.total ?? 0),
                description: "Matching filters",
                icon: ScrollText,
              },
              {
                label: "Shell Commands",
                value: String(shellCommands),
                description: "On this page",
                icon: TerminalSquare,
              },
              {
                label: "Errors",
                value: String(errors),
                description: "On this page",
                icon: AlertCircle,
              },
              {
                label: "Tool Calls",
                value: String(toolCalls),
                description: "On this page",
                icon: Wrench,
              },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label}>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                      <CardDescription>{stat.label}</CardDescription>
                      <CardTitle className="text-3xl">{stat.value}</CardTitle>
                    </div>
                    <div className="rounded-md bg-muted p-2 text-muted-foreground">
                      <Icon className="size-4" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{stat.description}</p>
                  </CardContent>
                </Card>
              );
            })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Narrow audit events by event type, tool name, agent run, and time window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">Event type</p>
              <Select
                value={draftFilters.eventType}
                onValueChange={(value) =>
                  setDraftFilters((current) => ({
                    ...current,
                    eventType: value as EventTypeFilter,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All event types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="tool_call">Tool Call</SelectItem>
                  <SelectItem value="shell_command">Shell Command</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Tool name</p>
              <Input
                value={draftFilters.toolName}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    toolName: event.target.value,
                  }))
                }
                placeholder="bash"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Agent run ID</p>
              <Input
                value={draftFilters.agentRunId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    agentRunId: event.target.value,
                  }))
                }
                placeholder="run_12345678"
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
            <div className="space-y-2">
              <p className="text-sm font-medium">Since</p>
              <Input
                type="datetime-local"
                value={draftFilters.since}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    since: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Until</p>
              <Input
                type="datetime-local"
                value={draftFilters.until}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    until: event.target.value,
                  }))
                }
              />
            </div>
            <Button
              onClick={() => {
                setPage(1);
                setAppliedFilters({ ...draftFilters });
              }}
              disabled={loading || refreshing}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const nextFilters = buildDefaultFilters();
                setPage(1);
                setDraftFilters(nextFilters);
                setAppliedFilters(nextFilters);
              }}
              disabled={loading || refreshing}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit events</CardTitle>
          <CardDescription>
            Click a row to inspect arguments, results, and linked identifiers inline. Auto-refreshes every 30 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg border">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tool/Command</TableHead>
                  <TableHead>Run ID</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data
                  ? Array.from({ length: 6 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="mx-auto h-4 w-4" /></TableCell>
                      </TableRow>
                    ))
                  : null}

                {!loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No audit events matched the current filters.
                    </TableCell>
                  </TableRow>
                ) : null}

                {items.map((event) => {
                  const isOpen = expandedEventId === event.id;
                  const ok = !event.error_message;
                  const toolName = event.tool_name ? truncate(event.tool_name, 30) : "—";
                  const runId = event.agent_run_id ? `#${event.agent_run_id.slice(-8)}` : "—";

                  return (
                    <Fragment key={event.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpandedEventId((current) =>
                            current === event.id ? null : event.id,
                          )
                        }
                        aria-expanded={isOpen}
                      >
                        <TableCell className="text-muted-foreground">
                          <span title={absoluteTime(event.created_at)}>{timeAgo(event.created_at)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("font-medium", EVENT_BADGE_STYLES[event.event_type])}
                          >
                            {eventTypeLabel(event.event_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-0">
                          <span
                            className="block max-w-[18rem] truncate font-medium"
                            title={event.tool_name ?? undefined}
                          >
                            {toolName}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground" title={event.agent_run_id ?? undefined}>
                          {runId}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatDuration(event.duration_ms)}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className="inline-flex"
                            title={ok ? "Success" : "Error"}
                          >
                            {ok ? (
                              <CheckCircle2 className="mx-auto size-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <XCircle className="mx-auto size-4 text-red-600 dark:text-red-400" />
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={6}>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Args Preview
                                </p>
                                <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                                  {formatPreview(event.args_preview)}
                                </pre>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Result Preview
                                </p>
                                <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                                  {formatPreview(event.result_preview)}
                                </pre>
                              </div>
                              {event.error_message ? (
                                <div className="space-y-2 lg:col-span-2">
                                  <p className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
                                    Error Message
                                  </p>
                                  <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs text-red-600 dark:text-red-400">
                                    {event.error_message}
                                  </pre>
                                </div>
                              ) : null}
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Full Run ID
                                </p>
                                <p className="mt-1 break-all text-sm">{event.agent_run_id ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Session ID
                                </p>
                                <p className="mt-1 break-all text-sm">{event.session_id ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  User ID
                                </p>
                                <p className="mt-1 break-all text-sm">{event.user_id ?? "—"}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data?.page ?? page} of {pageCount} ({data?.total ?? 0} total)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="mr-1 size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount || loading}
              >
                Next
                <ChevronRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
