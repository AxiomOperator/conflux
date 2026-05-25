"use client";

import {
  BrainCircuit,
  DatabaseZap,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Server,
  Wrench,
  Zap,
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

interface DiagnosticCheck {
  service: string;
  status: "ok" | "degraded" | "error";
  latency_ms: number;
  message: string;
}

interface DiagnosticReport {
  overall: "ok" | "degraded" | "error";
  checks: DiagnosticCheck[];
}

const STATUS_STYLES = {
  ok: {
    badge: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400",
    dot: "bg-green-500",
    card: "border-green-500/20 bg-green-500/5",
    label: "OK",
  },
  degraded: {
    badge: "border-yellow-200 bg-yellow-100 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-400",
    dot: "bg-yellow-500",
    card: "border-yellow-500/20 bg-yellow-500/5",
    label: "Degraded",
  },
  error: {
    badge: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400",
    dot: "bg-red-500",
    card: "border-red-500/20 bg-red-500/5",
    label: "Error",
  },
} as const;

function serviceIcon(service: string) {
  if (service === "postgres") return <DatabaseZap className="size-4" />;
  if (service === "qdrant") return <Network className="size-4" />;
  if (service === "dragonflydb") return <Zap className="size-4" />;
  if (service === "searxng") return <Search className="size-4" />;
  if (service.startsWith("llm:")) return <BrainCircuit className="size-4" />;
  return <Server className="size-4" />;
}

function serviceLabel(service: string) {
  if (service.startsWith("llm:")) {
    return `LLM · ${service.slice(4)}`;
  }
  if (service === "dragonflydb") {
    return "DragonflyDB / Redis";
  }
  if (service === "postgres") {
    return "PostgreSQL";
  }
  if (service === "qdrant") {
    return "Qdrant";
  }
  if (service === "searxng") {
    return "SearXNG";
  }
  return service;
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
    message?: string;
  } | null;
  return data?.detail ?? data?.error ?? data?.message ?? fallback;
}

export function DiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostics = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/admin/doctor", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to run diagnostics."),
        );
      }

      const data = (await response.json()) as DiagnosticReport;
      setReport(data);
      setError(null);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to run diagnostics.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics();
    const timer = setInterval(() => {
      void fetchDiagnostics(true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchDiagnostics]);

  const overall = report?.overall ?? "error";
  const overallStyle = STATUS_STYLES[overall];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <Wrench className="size-7" />
            Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground">
            Live health checks for Conflux core infrastructure.
          </p>
        </div>
        <Button onClick={() => void fetchDiagnostics(true)} disabled={loading || refreshing}>
          {loading || refreshing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Run diagnostics
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>System health</CardTitle>
              <CardDescription>
                Auto-refreshes every 30 seconds and can be run on demand.
              </CardDescription>
            </div>
            <Badge variant="outline" className={overallStyle.badge}>
              {overallStyle.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : null}

          {loading && !report ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Running diagnostics…
            </div>
          ) : null}

          {report?.checks.map((check) => {
            const style = STATUS_STYLES[check.status];
            return (
              <div
                key={check.service}
                className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center ${style.card}`}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background/80 text-muted-foreground">
                  {serviceIcon(check.service)}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{serviceLabel(check.service)}</span>
                    <span className={`size-2 rounded-full ${style.dot}`} />
                    <span className="text-xs text-muted-foreground">
                      {style.label}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {check.message || "Healthy"}
                  </p>
                </div>
                <div className="text-sm font-medium text-muted-foreground">
                  {check.latency_ms} ms
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
