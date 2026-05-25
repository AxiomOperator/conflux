"use client";

import {
  Activity,
  BotIcon,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Clock,
  DatabaseZap,
  FlaskConical,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  Search,
  Server,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
import type { AdminStats, Agent, Provider } from "@/lib/api";
import { shortId } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardStats = AdminStats;

interface ServiceStatus {
  name: string;
  kind: string;
  status: "ok" | "error";
  latency_ms: number;
  detail?: string;
}

interface ActivityEvent {
  type: "run" | "memory" | "reflection";
  subtype?: string;
  id: string;
  timestamp: string | null;
  message: string;
  agent_name?: string;
  run_id?: string;
  scope?: string;
  memories_count?: number;
  skills_count?: number;
}

interface Run {
  id: string;
  status: string;
  agent_id: string;
  agent_name?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function eventIcon(ev: ActivityEvent) {
  if (ev.type === "run") {
    if (ev.subtype === "running") return <Loader2 className="size-3.5 animate-spin text-amber-500" />;
    if (ev.subtype === "completed") return <CheckCircle2 className="size-3.5 text-green-500" />;
    if (ev.subtype === "failed") return <XCircle className="size-3.5 text-destructive" />;
    return <Clock className="size-3.5 text-muted-foreground" />;
  }
  if (ev.type === "memory") return <DatabaseZap className="size-3.5 text-blue-500" />;
  if (ev.type === "reflection") return <FlaskConical className="size-3.5 text-purple-500" />;
  return <Activity className="size-3.5 text-muted-foreground" />;
}

function serviceIcon(kind: string) {
  if (kind === "database") return <DatabaseZap className="size-3.5" />;
  if (kind === "vector-db") return <Network className="size-3.5" />;
  if (kind === "cache") return <Zap className="size-3.5" />;
  if (kind === "search") return <Search className="size-3.5" />;
  if (kind === "ai") return <BrainCircuit className="size-3.5" />;
  if (kind === "channel") return <MessageSquare className="size-3.5" />;
  return <Server className="size-3.5" />;
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

export function DashboardPage({
  initialStats,
  initialRuns,
  initialAgents,
  providers: initialProviders,
}: {
  initialStats: DashboardStats | null;
  initialRuns: Run[];
  initialAgents: Agent[];
  providers: Provider[];
}) {
  const [stats, setStats] = useState<DashboardStats | null>(initialStats);
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [agents] = useState<Agent[]>(initialAgents);
  const [providers, setProviders] = useState<Provider[]>(initialProviders);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pingState, setPingState] = useState<Record<string, "idle" | "pinging" | "ok" | "fail">>({});
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch services status ──
  const fetchServices = useCallback(async () => {
    setServicesLoading(true);
    const res = await fetch("/api/admin/services-status").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as ServiceStatus[];
      setServices(data);
    }
    setServicesLoading(false);
  }, []);

  // ── Fetch activity feed ──
  const fetchActivity = useCallback(async () => {
    const res = await fetch("/api/admin/activity-feed?limit=15").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as ActivityEvent[];
      setActivity(data);
    }
  }, []);

  // ── Refresh all data ──
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const [statsRes, runsRes, activityRes] = await Promise.allSettled([
        fetch("/api/admin/stats"),
        fetch("/api/runs?limit=10"),
        fetch("/api/admin/activity-feed?limit=15"),
      ]);

      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        setStats((await statsRes.value.json()) as DashboardStats);
      }
      if (runsRes.status === "fulfilled" && runsRes.value.ok) {
        setRuns((await runsRes.value.json()) as Run[]);
      }
      if (activityRes.status === "fulfilled" && activityRes.value.ok) {
        setActivity((await activityRes.value.json()) as ActivityEvent[]);
      }
      setLastRefreshed(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // ── Initial activity load + auto-refresh every 30s ──
  useEffect(() => {
    void fetchActivity();
    void fetchServices();
    timerRef.current = setInterval(() => { void refresh(true); void fetchServices(); }, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchActivity, refresh]);

  // ── Ping a single provider ──
  const pingProvider = useCallback(async (providerId: string) => {
    setPingState((prev) => ({ ...prev, [providerId]: "pinging" }));
    try {
      const res = await fetch(`/api/providers/${providerId}/health-check`, {
        method: "POST",
      });
      const data = (await res.json()) as { healthy?: boolean };
      const healthy = data?.healthy === true;
      setPingState((prev) => ({ ...prev, [providerId]: healthy ? "ok" : "fail" }));
      setProviders((prev) =>
        prev.map((p) =>
          p.id === providerId
            ? { ...p, healthy, health_status: healthy ? "healthy" : "unhealthy" }
            : p,
        ),
      );
    } catch {
      setPingState((prev) => ({ ...prev, [providerId]: "fail" }));
    }
  }, []);

  const agentNames = new Map(agents.map((a) => [a.id, a.name]));
  const runningCount = stats?.running_runs ?? 0;

  const statCards = [
    {
      label: "Active agents",
      value: agents.filter((a) => a.status !== "disabled").length,
      icon: Boxes,
      href: "/agents",
      sub: `${agents.filter((a) => a.agent_type === "orchestrator").length} orchestrators`,
    },
    {
      label: runningCount > 0 ? "Running now" : "Total runs",
      value: runningCount > 0 ? runningCount : (stats?.total_runs ?? 0),
      icon: runningCount > 0 ? Zap : Activity,
      href: "/runs",
      live: runningCount > 0,
      sub: runningCount > 0 ? "agents active" : `${stats?.completed_runs ?? 0} completed`,
    },
    {
      label: "Memory entries",
      value: stats?.total_memories ?? 0,
      icon: DatabaseZap,
      href: "/memory",
      sub: `${stats?.reflection_completed ?? 0} reflections done`,
    },
    {
      label: "Skills",
      value: stats?.pending_skills ?? 0,
      icon: BrainCircuit,
      href: "/skills",
      sub: "pending review",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live visibility into agents, runs, memory, and providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block" suppressHydrationWarning>
            Updated {relativeTime(lastRefreshed.toISOString())}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`size-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.label} href={stat.href}>
              <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </CardTitle>
                  <div className="relative">
                    <Icon className="size-4 text-muted-foreground" />
                    {stat.live && (
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 animate-pulse" />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{stat.value}</div>
                  {stat.sub && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{stat.sub}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      {/* Main content grid */}
      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Recent runs table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent runs</CardTitle>
                <CardDescription>Latest 10 runs across the tenant.</CardDescription>
              </div>
              <Link href="/runs">
                <Button variant="ghost" size="sm" className="text-xs">
                  View all →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Run</th>
                    <th className="px-4 py-2 text-left font-medium">Agent</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        No runs yet.
                      </td>
                    </tr>
                  )}
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <Link href={`/runs/${run.id}`} className="hover:text-primary">
                          {shortId(run.id, 10)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        {run.agent_name ?? agentNames.get(run.agent_id) ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={run.status} compact />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground" suppressHydrationWarning>
                        {relativeTime(run.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Activity
              {runningCount > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
                  <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                  {runningCount} live
                </span>
              )}
            </CardTitle>
            <CardDescription>Recent system events, auto-refreshes every 30s.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto max-h-[380px] pr-2">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {activity.map((ev) => (
                  <li key={`${ev.type}-${ev.id}`} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 shrink-0">{eventIcon(ev)}</span>
                    <div className="flex-1 min-w-0">
                      {ev.type === "run" && ev.run_id ? (
                        <Link
                          href={`/runs/${ev.run_id}`}
                          className="hover:text-primary line-clamp-1"
                        >
                          {ev.message}
                        </Link>
                      ) : (
                        <p className="line-clamp-1">{ev.message}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5" suppressHydrationWarning>
                        {relativeTime(ev.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Provider health + Colony */}
      <section className="grid gap-6 xl:grid-cols-2">
        {/* Provider health */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Server className="size-4" />
                  Provider health
                </CardTitle>
                <CardDescription>Ping each provider to check availability.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No providers configured.</p>
            ) : (
              <div className="space-y-2">
                {providers.filter((p) => !!p.id).map((p) => {
                  const pid = p.id as string;
                  const pState = pingState[pid] ?? "idle";
                  const health = p.healthy ? "healthy" : (p.health_status ?? "unknown");
                  return (
                    <div
                      key={pid}
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <StatusBadge
                          status={pState === "ok" ? "healthy" : pState === "fail" ? "unhealthy" : health}
                          compact
                        />
                        <span className="font-medium text-sm truncate">{p.name}</span>
                        {p.provider_type && (
                          <Badge variant="outline" className="text-[10px] hidden sm:inline-flex">
                            {p.provider_type}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 shrink-0"
                        disabled={pState === "pinging"}
                        onClick={() => void pingProvider(pid)}
                      >
                        {pState === "pinging" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Ping"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Colony / agent summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BotIcon className="size-4" />
                  Colony
                </CardTitle>
                <CardDescription>Agent roster and activity summary.</CardDescription>
              </div>
              <Link href="/colony">
                <Button variant="ghost" size="sm" className="text-xs">
                  View colony →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents configured.</p>
            ) : (
              <div className="space-y-1.5">
                {agents.slice(0, 6).map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between text-sm py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{agent.name}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize hidden sm:inline-flex"
                      >
                        {agent.agent_type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(agent.active_runs ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                          {agent.active_runs}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {agent.total_runs ?? 0} runs
                      </span>
                    </div>
                  </div>
                ))}
                {agents.length > 6 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    +{agents.length - 6} more agents
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Self-learning summary */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" />
              Self-learning loop
            </CardTitle>
            <CardDescription>
              Reflection and evolution pipeline snapshot.{" "}
              <Link href="/learning" className="text-primary underline underline-offset-2">
                View full learning dashboard →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Reflections done</p>
                <p className="mt-1 text-2xl font-semibold">{stats?.reflection_completed ?? 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Reflections pending</p>
                <p className="mt-1 text-2xl font-semibold">{stats?.reflection_pending ?? 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Evolution candidates</p>
                <p className="mt-1 text-2xl font-semibold">{stats?.evolution_pending ?? 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Total memories</p>
                <p className="mt-1 text-2xl font-semibold">{stats?.total_memories ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Infrastructure services status */}
      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Server className="size-4" />
                  Infrastructure
                </CardTitle>
                <CardDescription>Live status of connected services.</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchServices()}
                disabled={servicesLoading}
                className="text-xs"
              >
                <RefreshCw className={`size-3.5 mr-1.5 ${servicesLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {servicesLoading && services.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="size-4 animate-spin" /> Checking services…
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((svc) => (
                  <div
                    key={svc.name}
                    className={`flex items-center gap-3 rounded-lg border p-3 ${
                      svc.status === "ok"
                        ? "border-green-500/20 bg-green-500/5"
                        : "border-destructive/20 bg-destructive/5"
                    }`}
                  >
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                        svc.status === "ok"
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {serviceIcon(svc.kind)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-none">{svc.name}</p>
                      {svc.status === "ok" ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{svc.latency_ms} ms</p>
                      ) : (
                        <p className="mt-0.5 truncate text-xs text-destructive" title={svc.detail}>
                          {svc.detail ?? "Unreachable"}
                        </p>
                      )}
                    </div>
                    {svc.status === "ok" ? (
                      <Wifi className="size-4 shrink-0 text-green-500" />
                    ) : (
                      <WifiOff className="size-4 shrink-0 text-destructive" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
