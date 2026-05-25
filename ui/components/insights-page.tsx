"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DailyRunCount = {
  date: string;
  count: number;
};

type TopAgent = {
  agent_id: string;
  agent_name: string;
  run_count: number;
};

type UserInsights = {
  total_runs: number;
  runs_by_status: Record<string, number>;
  total_tokens: number;
  runs_last_30_days: DailyRunCount[];
  top_agents: TopAgent[];
  avg_response_time_ms: number;
};

type AdminInsights = UserInsights & {
  total_users: number;
  active_users_30d: number;
  system_total_runs: number;
  system_total_tokens: number;
  system_runs_by_status?: Record<string, number>;
  user_runs_last_30_days?: DailyRunCount[];
  user_top_agents?: TopAgent[];
};

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function formatDuration(value: number) {
  if (!value || value <= 0) {
    return "—";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function shortDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function successRate(insights: UserInsights | null) {
  if (!insights || !insights.total_runs) {
    return 0;
  }
  return ((insights.runs_by_status.completed ?? 0) / insights.total_runs) * 100;
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function LoadingPanel({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Loading analytics…</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-72 animate-pulse rounded-lg bg-muted" />
      </CardContent>
    </Card>
  );
}

function TopAgentsTable({ agents }: { agents: TopAgent[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Runs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length > 0 ? (
            agents.map((agent) => (
              <TableRow key={agent.agent_id}>
                <TableCell>
                  <div className="font-medium">{agent.agent_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {agent.agent_id}
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatNumber(agent.run_count)}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                No runs yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function InsightsPage({ isAdmin }: { isAdmin: boolean }) {
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [adminInsights, setAdminInsights] = useState<AdminInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async (initialLoad = false) => {
    if (initialLoad) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const [userResponse, adminResponse] = await Promise.all([
        fetch("/api/insights", { cache: "no-store" }),
        isAdmin ? fetch("/api/admin/insights", { cache: "no-store" }) : Promise.resolve(null),
      ]);

      if (!userResponse.ok) {
        const body = (await userResponse.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Failed to load insights (${userResponse.status}).`);
      }

      const userData = (await userResponse.json()) as UserInsights;
      setInsights(userData);

      if (adminResponse) {
        if (!adminResponse.ok) {
          const body = (await adminResponse.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `Failed to load admin insights (${adminResponse.status}).`);
        }
        const adminData = (await adminResponse.json()) as AdminInsights;
        setAdminInsights(adminData);
      } else {
        setAdminInsights(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load insights.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadInsights(true);
  }, [loadInsights]);

  const personalSuccessRate = useMemo(() => successRate(insights), [insights]);
  const runsByStatusData = useMemo(
    () => [
      {
        label: "Completed",
        count: insights?.runs_by_status.completed ?? 0,
        fill: "#10b981",
      },
      {
        label: "Failed",
        count: insights?.runs_by_status.failed ?? 0,
        fill: "#f43f5e",
      },
      {
        label: "Running",
        count: insights?.runs_by_status.running ?? 0,
        fill: "#3b82f6",
      },
    ],
    [insights],
  );
  const personalTrendData = useMemo(
    () =>
      (insights?.runs_last_30_days ?? []).map((entry) => ({
        ...entry,
        label: shortDateLabel(entry.date),
      })),
    [insights],
  );
  const adminTrendData = useMemo(
    () =>
      (adminInsights?.runs_last_30_days ?? []).map((entry) => ({
        ...entry,
        label: shortDateLabel(entry.date),
      })),
    [adminInsights],
  );

  if (isLoading && !insights) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Insights</h1>
            <p className="text-sm text-muted-foreground">
              Analytics for your recent agent activity.
            </p>
          </div>
          <Button disabled variant="outline">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <LoadingCard key={index} />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
          <LoadingPanel title="Runs per day" />
          <LoadingPanel title="Runs by status" />
        </div>
        <LoadingPanel title="Top agents" />
      </div>
    );
  }

  if (!insights) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Insights unavailable</CardTitle>
          <CardDescription>{error ?? "Unable to load analytics."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadInsights(true)} variant="outline">
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            Analytics for your recent agent activity and response performance.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void loadInsights(false)}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Runs"
          value={formatNumber(insights.total_runs)}
          description="All runs created from your workspace."
        />
        <StatCard
          title="Total Tokens"
          value={formatNumber(insights.total_tokens)}
          description="Prompt + completion tokens across all runs."
        />
        <StatCard
          title="Avg Response Time"
          value={formatDuration(insights.avg_response_time_ms)}
          description="Average runtime for completed runs."
        />
        <StatCard
          title="Success Rate"
          value={formatPercent(personalSuccessRate)}
          description="Completed runs as a share of all runs."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Runs per day (last 30 days)</CardTitle>
            <CardDescription>Your activity trend over the last month.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height={288}>
                <LineChart data={personalTrendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <Tooltip
                    formatter={(value) => [formatNumber(Number(value)), "Runs"]}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.date ?? String(label)}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runs by status</CardTitle>
            <CardDescription>How your recent runs are resolving.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={runsByStatusData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <Tooltip formatter={(value) => [formatNumber(Number(value)), "Runs"]} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {runsByStatusData.map((entry) => (
                      <Cell key={entry.label} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top agents</CardTitle>
          <CardDescription>Your most frequently used agents.</CardDescription>
        </CardHeader>
        <CardContent>
          <TopAgentsTable agents={insights.top_agents} />
        </CardContent>
      </Card>

      {isAdmin && adminInsights ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">System Overview</h2>
            <p className="text-sm text-muted-foreground">
              Global usage and adoption metrics across the Conflux workspace.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Users"
              value={formatNumber(adminInsights.total_users)}
              description="All provisioned Conflux users."
            />
            <StatCard
              title="Active Users (30d)"
              value={formatNumber(adminInsights.active_users_30d)}
              description="Users with at least one run in the last 30 days."
            />
            <StatCard
              title="System Total Runs"
              value={formatNumber(adminInsights.system_total_runs)}
              description="Runs executed across every user account."
            />
            <StatCard
              title="System Total Tokens"
              value={formatNumber(adminInsights.system_total_tokens)}
              description="Workspace-wide prompt + completion token usage."
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
            <Card>
              <CardHeader>
                <CardTitle>System runs per day</CardTitle>
                <CardDescription>Workspace-wide activity for the last 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height={288}>
                    <LineChart data={adminTrendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <Tooltip
                        formatter={(value) => [formatNumber(Number(value)), "Runs"]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.date ?? String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System top agents</CardTitle>
                <CardDescription>Most-used agents across all users.</CardDescription>
              </CardHeader>
              <CardContent>
                <TopAgentsTable agents={adminInsights.top_agents} />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
