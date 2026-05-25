"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";

interface TracesPageResponse {
  items: TraceRecord[];
  total: number;
  page: number;
  page_size: number;
}

interface TraceRecord {
  id: string;
  created_at: string;
  method: string;
  path: string;
  query_string: string | null;
  status_code: number;
  duration_ms: number;
  user_email: string | null;
  remote_ip: string | null;
  user_agent: string | null;
  request_body: string | null;
  response_body: string | null;
}

type MethodFilter = "ALL" | "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";
type RangePreset = "today" | "24h" | "7d" | "custom";

const PAGE_SIZE = 20;

const METHOD_BADGE_STYLES: Record<string, string> = {
  GET: "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  POST: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  PUT: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  DELETE: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  PATCH: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-300",
};

const STATUS_BADGE_STYLES = {
  success:
    "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  redirect:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  client:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  server:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  neutral:
    "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
} as const;

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

function statusTone(statusCode: number) {
  if (statusCode >= 500) {
    return STATUS_BADGE_STYLES.server;
  }
  if (statusCode >= 400) {
    return STATUS_BADGE_STYLES.client;
  }
  if (statusCode >= 300) {
    return STATUS_BADGE_STYLES.redirect;
  }
  if (statusCode >= 200) {
    return STATUS_BADGE_STYLES.success;
  }
  return STATUS_BADGE_STYLES.neutral;
}

function statusBounds(filter: StatusFilter) {
  switch (filter) {
    case "2xx":
      return { min: 200, max: 299 };
    case "3xx":
      return { min: 300, max: 399 };
    case "4xx":
      return { min: 400, max: 499 };
    case "5xx":
      return { min: 500, max: 599 };
    default:
      return null;
  }
}

function formatBody(body: string | null) {
  if (!body || !body.trim()) {
    return "None";
  }
  return body;
}

function getRangeValues(
  rangePreset: RangePreset,
  customSince: string,
  customUntil: string,
) {
  const current = new Date();
  if (rangePreset === "today") {
    const start = new Date(current);
    start.setHours(0, 0, 0, 0);
    return { since: start.toISOString(), until: current.toISOString() };
  }
  if (rangePreset === "24h") {
    return {
      since: new Date(current.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      until: current.toISOString(),
    };
  }
  if (rangePreset === "7d") {
    return {
      since: new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      until: current.toISOString(),
    };
  }
  return {
    since: toIso(customSince),
    until: toIso(customUntil),
  };
}

export function RequestTracesPage() {
  const now = useMemo(() => new Date(), []);
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [pathContains, setPathContains] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [userEmail, setUserEmail] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("24h");
  const [customSince, setCustomSince] = useState(() =>
    toLocalDateTimeValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  );
  const [customUntil, setCustomUntil] = useState(() => toLocalDateTimeValue(now));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TracesPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setPage(1);
  }, [method, pathContains, statusFilter, userEmail, rangePreset, customSince, customUntil]);

  const fetchTraces = useCallback(
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
        const rangeValues = getRangeValues(rangePreset, customSince, customUntil);

        if (method !== "ALL") {
          params.set("method", method);
        }
        if (pathContains.trim()) {
          params.set("path_contains", pathContains.trim());
        }
        const bounds = statusBounds(statusFilter);
        if (bounds) {
          params.set("status_min", String(bounds.min));
          params.set("status_max", String(bounds.max));
        }
        if (userEmail.trim()) {
          params.set("user_email", userEmail.trim());
        }
        if (rangeValues.since) {
          params.set("since", rangeValues.since);
        }
        if (rangeValues.until) {
          params.set("until", rangeValues.until);
        }

        const response = await fetch(`/api/admin/traces?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "Failed to load request traces."));
        }
        if (requestId !== requestIdRef.current) {
          return;
        }

        const nextData = payload as TracesPageResponse;
        setData(nextData);
        setError(null);
        setExpandedTraceId((current) =>
          nextData.items.some((trace) => trace.id === current) ? current : null,
        );
      } catch (fetchError) {
        if (signal?.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load request traces.",
        );
      } finally {
        if (signal?.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setLoading(false);
        setRefreshing(false);
      }
    },
    [customSince, customUntil, method, page, pathContains, rangePreset, statusFilter, userEmail],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchTraces(controller.signal);
    return () => controller.abort();
  }, [fetchTraces]);

  const items = data?.items ?? [];
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const averageDuration =
    items.length > 0
      ? Math.round(
          items.reduce((total, trace) => total + trace.duration_ms, 0) / items.length,
        )
      : 0;
  const errorRate =
    items.length > 0
      ? Math.round(
          (items.filter((trace) => trace.status_code >= 400).length / items.length) * 100,
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Request Trace Log</h1>
          <p className="text-sm text-muted-foreground">
            Inspect proxied admin request traces, latency, and error responses.
          </p>
        </div>
        <Button onClick={() => void fetchTraces(undefined, true)} disabled={loading || refreshing}>
          {loading || refreshing ? (
            <Spinner className="mr-2 size-4" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Narrow request traces by method, path, status family, user, and time window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Method</p>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as MethodFilter)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All methods" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Path contains</p>
              <Input
                value={pathContains}
                onChange={(event) => setPathContains(event.target.value)}
                placeholder="/api/admin/traces"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Status</p>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All status codes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="2xx">2xx</SelectItem>
                  <SelectItem value="3xx">3xx</SelectItem>
                  <SelectItem value="4xx">4xx</SelectItem>
                  <SelectItem value="5xx">5xx</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">User email</p>
              <Input
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
                placeholder="admin@example.com"
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Time range</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Today", value: "today" },
                { label: "Last 24h", value: "24h" },
                { label: "Last 7d", value: "7d" },
                { label: "Custom", value: "custom" },
              ].map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={rangePreset === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRangePreset(option.value as RangePreset)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {rangePreset === "custom" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="datetime-local"
                  value={customSince}
                  onChange={(event) => setCustomSince(event.target.value)}
                />
                <Input
                  type="datetime-local"
                  value={customUntil}
                  onChange={(event) => setCustomUntil(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        {loading && !data
          ? Array.from({ length: 3 }, (_, index) => (
              <Card key={index}>
                <CardHeader className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-28" />
                </CardHeader>
              </Card>
            ))
          : [
              { label: "Total requests shown", value: String(items.length) },
              { label: "Avg duration", value: `${averageDuration}ms` },
              { label: "Error rate", value: `${errorRate}%` },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{stat.label}</CardDescription>
                  <CardTitle className="text-3xl">{stat.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Trace records</CardTitle>
          <CardDescription>
            Click a row to inspect request and response payload details inline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Path</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data
                  ? Array.from({ length: 6 }, (_, index) => (
                      <tr key={index} className="border-b">
                        <td className="px-4 py-4"><Skeleton className="h-6 w-16" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-64" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-6 w-14" /></td>
                        <td className="px-4 py-4"><Skeleton className="ml-auto h-4 w-16" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-36" /></td>
                        <td className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
                      </tr>
                    ))
                  : null}

                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No request traces matched the current filters.
                    </td>
                  </tr>
                ) : null}

                {items.map((trace) => {
                  const isOpen = expandedTraceId === trace.id;
                  const fullPath = trace.query_string
                    ? `${trace.path}?${trace.query_string}`
                    : trace.path;

                  return (
                    <Fragment key={trace.id}>
                      <tr
                        className="cursor-pointer border-b transition-colors hover:bg-muted/40"
                        onClick={() =>
                          setExpandedTraceId((current) =>
                            current === trace.id ? null : trace.id,
                          )
                        }
                        aria-expanded={isOpen}
                      >
                        <td className="px-4 py-4 align-middle">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-medium",
                              METHOD_BADGE_STYLES[trace.method] ?? STATUS_BADGE_STYLES.neutral,
                            )}
                          >
                            {trace.method}
                          </Badge>
                        </td>
                        <td className="max-w-0 px-4 py-4 align-middle">
                          <div className="flex items-center gap-2">
                            <span
                              className="block max-w-[28rem] truncate font-medium"
                              title={trace.path}
                            >
                              {truncate(trace.path, 60)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <Badge variant="outline" className={statusTone(trace.status_code)}>
                            {trace.status_code}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-right align-middle font-medium">
                          {Math.round(trace.duration_ms)}ms
                        </td>
                        <td className="px-4 py-4 align-middle text-muted-foreground">
                          {trace.user_email ?? "—"}
                        </td>
                        <td className="px-4 py-4 align-middle text-muted-foreground">
                          {timeAgo(trace.created_at)}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-3 lg:col-span-2">
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Full path
                                  </p>
                                  <p className="mt-1 break-all font-mono text-sm">{fullPath}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Remote IP
                                </p>
                                <p className="mt-1 break-all text-sm">{trace.remote_ip ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  User Agent
                                </p>
                                <p className="mt-1 break-all text-sm">{trace.user_agent ?? "—"}</p>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Request Body
                                </p>
                                <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-5">
                                  {formatBody(trace.request_body)}
                                </pre>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Response Body
                                </p>
                                <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-5">
                                  {formatBody(trace.response_body)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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

