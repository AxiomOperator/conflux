import { Bot, Crown, Network, Workflow, Zap } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
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
import { createServerApiClient } from "@/lib/server-api";
import type { Agent, ColonyRun } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";

export const dynamic = "force-dynamic";

function AgentCard({ agent }: { agent: Agent }) {
  const isOrchestrator = agent.agent_type === "orchestrator";
  const Icon = isOrchestrator ? Crown : Bot;

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isOrchestrator
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
              isOrchestrator
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Icon className="size-4" />
          </div>
          <div>
            <p className="font-semibold leading-tight">{agent.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {agent.agent_type}
            </p>
          </div>
        </div>
        <StatusBadge status={agent.status ?? "active"} compact />
      </div>

      {agent.description && (
        <p className="mt-2.5 text-xs text-muted-foreground line-clamp-2">
          {agent.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-1 rounded-md border px-2 py-1">
          <Zap className="size-3 text-amber-500" />
          <span className="font-medium">{agent.active_runs ?? 0}</span>
          <span className="text-muted-foreground">active</span>
        </div>
        <div className="flex items-center gap-1 rounded-md border px-2 py-1">
          <Workflow className="size-3 text-muted-foreground" />
          <span className="font-medium">{agent.total_runs ?? 0}</span>
          <span className="text-muted-foreground">total runs</span>
        </div>
        {(agent.tool_allowlist?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1 rounded-md border px-2 py-1">
            <span className="font-medium">{agent.tool_allowlist!.length}</span>
            <span className="text-muted-foreground">tools</span>
          </div>
        )}
      </div>

      {(agent.tool_allowlist?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.tool_allowlist!.slice(0, 5).map((tool) => (
            <Badge key={tool} variant="secondary" className="text-[10px]">
              {tool}
            </Badge>
          ))}
          {agent.tool_allowlist!.length > 5 && (
            <Badge variant="outline" className="text-[10px]">
              +{agent.tool_allowlist!.length - 5} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function buildDelegationTree(runs: ColonyRun[]): Map<string, ColonyRun[]> {
  const tree = new Map<string, ColonyRun[]>();
  for (const run of runs) {
    if (run.parent_run_id) {
      const siblings = tree.get(run.parent_run_id) ?? [];
      siblings.push(run);
      tree.set(run.parent_run_id, siblings);
    }
  }
  return tree;
}

export default async function ColonyPage() {
  const client = await createServerApiClient();
  const colony = await client.agents.colony().catch(() => null);

  const agents = colony?.agents ?? [];
  const runs = colony?.recent_runs ?? [];

  const orchestrators = agents.filter((a) => a.agent_type === "orchestrator");
  const workers = agents.filter((a) => a.agent_type !== "orchestrator");

  const delegationTree = buildDelegationTree(runs);
  const parentRuns = runs.filter(
    (r) => r.parent_run_id === null && delegationTree.has(r.id),
  );

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const totalActive = agents.reduce((s, a) => s + (a.active_runs ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Colony</h1>
        <p className="text-sm text-muted-foreground">
          Agent hive topology — orchestrators, workers, and active delegation chains.
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
          <Crown className="size-4 text-primary" />
          <span className="font-medium">{orchestrators.length}</span>
          <span className="text-muted-foreground">orchestrator{orchestrators.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
          <Bot className="size-4 text-muted-foreground" />
          <span className="font-medium">{workers.length}</span>
          <span className="text-muted-foreground">worker{workers.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
          <Zap className="size-4 text-amber-500" />
          <span className="font-medium">{totalActive}</span>
          <span className="text-muted-foreground">active run{totalActive !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
          <Network className="size-4 text-muted-foreground" />
          <span className="font-medium">{delegationTree.size}</span>
          <span className="text-muted-foreground">delegation chain{delegationTree.size !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Orchestrators */}
      {orchestrators.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <Crown className="size-3.5" />
            Orchestrators
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orchestrators.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}

      {/* Workers */}
      {workers.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <Bot className="size-3.5" />
            Workers
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {workers.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}

      {agents.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Bot className="mx-auto mb-3 size-8 opacity-30" />
            <p>No agents in the colony yet.</p>
            <p className="mt-1 text-xs">
              Create agents from the{" "}
              <a href="/agents" className="text-primary underline">
                Agents
              </a>{" "}
              page.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Delegation chains */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4" />
            Delegation chains
          </CardTitle>
          <CardDescription>
            Recent parent → subagent run delegations from the hive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {parentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subagent delegations recorded yet. When an orchestrator spawns a
              subagent, the delegation chain will appear here.
            </p>
          ) : (
            <div className="space-y-3">
              {parentRuns.map((parent) => {
                const children = delegationTree.get(parent.id) ?? [];
                const parentAgent = agentMap.get(parent.agent_id);
                return (
                  <div key={parent.id} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Crown className="size-3.5 text-primary" />
                      <span className="text-sm font-medium">
                        {parentAgent?.name ?? "Unknown agent"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortId(parent.id, 8)}
                      </span>
                      <StatusBadge status={parent.status} compact />
                    </div>
                    <div className="ml-4 mt-2 space-y-1.5 border-l-2 border-dashed pl-3">
                      {children.map((child) => {
                        const childAgent = agentMap.get(child.agent_id);
                        return (
                          <div
                            key={child.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Bot className="size-3 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              {childAgent?.name ?? "Worker"}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {shortId(child.id, 8)}
                            </span>
                            <StatusBadge status={child.status} compact />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent runs table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>Latest 50 runs across the colony.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Parent run</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs">
                      {shortId(run.id, 10)}
                    </TableCell>
                    <TableCell>
                      {agentMap.get(run.agent_id)?.name ?? shortId(run.agent_id, 8)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {run.parent_run_id ? shortId(run.parent_run_id, 8) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(run.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
