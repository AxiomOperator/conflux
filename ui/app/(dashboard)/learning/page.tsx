import {
  BookOpen,
  BrainCircuit,
  Clock,
  DatabaseZap,
  FlaskConical,
  Sparkles,
} from "lucide-react";

import { EvolutionCandidatesTable } from "@/components/evolution-candidates-table";
import { ReflectionJobsTable } from "@/components/reflection-jobs-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isEffectiveAdmin } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { createServerApiClient } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const client = await createServerApiClient();
  const [stats, metrics, me] = await Promise.all([
    client.admin.stats().catch(() => null),
    client.admin.learningMetrics().catch(() => null),
    client.users.me().catch(() => null),
  ]);
  const isAdmin = isEffectiveAdmin(me);

  const summaryCards = [
    {
      label: "Total memories",
      value: stats?.total_memories ?? 0,
      icon: DatabaseZap,
      description: "Scoped facts learned across all agents",
    },
    {
      label: "Reflections completed",
      value: stats?.reflection_completed ?? 0,
      icon: BrainCircuit,
      description: "Post-run reflection jobs that finished",
    },
    {
      label: "Pending reflections",
      value: stats?.reflection_pending ?? 0,
      icon: Clock,
      description: "Queued reflection jobs awaiting the worker",
    },
    {
      label: "Evolution candidates",
      value: stats?.evolution_pending ?? 0,
      icon: Sparkles,
      description: "Skill mutations awaiting admin approval",
    },
  ];

  const timeline = metrics?.memory_timeline ?? [];
  const maxCount = Math.max(...timeline.map((t) => t.count), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Learning</h1>
        <p className="text-sm text-muted-foreground">
          Self-learning loop metrics — memory growth, reflection activity, and
          skill evolution.
        </p>
      </div>

      {/* Summary cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{card.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* Memory timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseZap className="size-4" />
              Memory growth (14 days)
            </CardTitle>
            <CardDescription>
              New memory entries written per day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No memory entries yet.
              </p>
            ) : (
              <div className="space-y-1">
                <div className="flex h-32 items-end gap-1">
                  {timeline.map((point) => (
                    <div
                      key={point.day}
                      className="group relative flex flex-1 flex-col items-center"
                    >
                      <span className="absolute -top-5 hidden text-[9px] font-medium text-foreground group-hover:block whitespace-nowrap">
                        {point.count}
                      </span>
                      <div
                        className="w-full rounded-t bg-primary/60 transition-all group-hover:bg-primary"
                        style={{
                          height: `${(point.count / maxCount) * 100}%`,
                          minHeight: "2px",
                        }}
                      />
                    </div>
                  ))}
                </div>
                {/* X-axis labels — show first, mid, last */}
                <div className="flex justify-between px-0.5">
                  <span className="text-[9px] text-muted-foreground">
                    {timeline[0]?.day.slice(5)}
                  </span>
                  {timeline.length > 2 && (
                    <span className="text-[9px] text-muted-foreground">
                      {timeline[Math.floor(timeline.length / 2)]?.day.slice(5)}
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground">
                    {timeline[timeline.length - 1]?.day.slice(5)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent memories */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4" />
              Recent memories
            </CardTitle>
            <CardDescription>
              Latest facts written to the memory store.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(metrics?.recent_memories ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No memories stored yet.
              </p>
            ) : (
              metrics!.recent_memories.map((mem) => (
                <div
                  key={mem.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{mem.key}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                        {mem.scope}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {mem.created_at ? formatDateTime(mem.created_at) : ""}
                      </span>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {mem.value}
                  </p>
                  {(mem.tags?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {mem.tags!.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-muted/70 px-1 py-px text-[9px] text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* Reflection jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-4" />
            Reflection jobs
          </CardTitle>
          <CardDescription>
            Post-run reflection activity — click a row to see what was learned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReflectionJobsTable jobs={metrics?.reflection_jobs ?? []} />
        </CardContent>
      </Card>

      {/* Evolution candidates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Evolution candidates
          </CardTitle>
          <CardDescription>
            Proposed skill mutations from the offline evolution loop. Click
            &ldquo;Diff&rdquo; to compare current vs proposed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EvolutionCandidatesTable
            candidates={metrics?.evolution_candidates ?? []}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>
    </div>
  );
}
