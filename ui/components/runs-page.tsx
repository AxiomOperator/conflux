"use client";

import { Loader2, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Agent, AgentRun } from "@/lib/api";
import { formatDateTime, formatDuration, shortId, truncate } from "@/lib/format";

export function RunsPage({
  agents,
  runs,
}: {
  agents: Agent[];
  runs: AgentRun[];
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("all");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newRunAgentId, setNewRunAgentId] = useState("");
  const [newRunMessage, setNewRunMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newRunError, setNewRunError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AgentRun[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  async function handleNewRun() {
    if (!newRunAgentId) {
      setNewRunError("Select an agent.");
      return;
    }
    if (!newRunMessage.trim()) {
      setNewRunError("Enter a message.");
      return;
    }
    try {
      setSubmitting(true);
      setNewRunError(null);
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: newRunAgentId,
          messages: [{ role: "user", content: newRunMessage.trim() }],
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { run_id?: string };
      setNewRunOpen(false);
      setNewRunMessage("");
      setNewRunAgentId("");
      if (data.run_id) {
        router.push(`/runs/${data.run_id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setNewRunError(err instanceof Error ? err.message : "Failed to create run.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetNewRun() {
    setNewRunAgentId("");
    setNewRunMessage("");
    setNewRunError(null);
  }

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/runs/search?query=${encodeURIComponent(trimmedQuery)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as AgentRun[];
        if (!cancelled) {
          setSearchResults(data);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const isSearchActive = searchQuery.trim().length > 0;
  const visibleRuns = isSearchActive ? searchResults : runs;
  const statuses = useMemo(
    () => ["all", ...new Set(visibleRuns.map((run) => run.status))],
    [visibleRuns],
  );
  const filteredRuns = useMemo(
    () =>
      statusFilter === "all"
        ? visibleRuns
        : visibleRuns.filter((run) => run.status === statusFilter),
    [statusFilter, visibleRuns],
  );

  useEffect(() => {
    if (!statuses.includes(statusFilter)) {
      setStatusFilter("all");
    }
  }, [statusFilter, statuses]);

  const columns = useMemo<DataTableColumn<AgentRun>[]>(() => {
    const allowSorting = !isSearchActive;
    const baseColumns: DataTableColumn<AgentRun>[] = [
      {
        header: "Run ID",
        key: "id",
        render: (run) => (
          <span className="font-medium">{shortId(run.id, 10)}</span>
        ),
        sortable: allowSorting,
        sortValue: (run) => run.id,
      },
      {
        header: "Agent",
        key: "agent_id",
        render: (run) =>
          run.agent_name ?? agentNames.get(run.agent_id) ?? "Unknown agent",
        sortable: allowSorting,
        sortValue: (run) =>
          run.agent_name ?? agentNames.get(run.agent_id) ?? run.agent_id,
      },
    ];

    if (isSearchActive) {
      baseColumns.push({
        className: "max-w-xl",
        header: "Match",
        key: "match",
        render: (run) => (
          <div className="space-y-1">
            <p className="text-sm font-medium">Input: {truncate(run.input, 120)}</p>
            {run.output ? (
              <p className="text-xs text-muted-foreground">
                Output: {truncate(run.output, 120)}
              </p>
            ) : null}
          </div>
        ),
        sortable: allowSorting,
        sortValue: (run) => `${run.input} ${run.output ?? ""}`,
      });
    }

    baseColumns.push(
      {
        header: "Status",
        key: "status",
        render: (run) => <StatusBadge status={run.status} />,
        sortable: allowSorting,
        sortValue: (run) => run.status,
      },
      {
        header: "Created",
        key: "created_at",
        render: (run) => formatDateTime(run.created_at),
        sortable: allowSorting,
        sortValue: (run) => run.created_at,
      },
      {
        header: "Duration",
        key: "duration",
        render: (run) => formatDuration(run.started_at, run.completed_at),
        sortable: allowSorting,
        sortValue: (run) =>
          run.started_at && run.completed_at
            ? new Date(run.completed_at).valueOf() -
              new Date(run.started_at).valueOf()
            : 0,
      },
    );

    return baseColumns;
  }, [agentNames, isSearchActive]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground">
            Monitor agent execution and drill into detailed output by run.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-2 text-sm font-medium sm:min-w-80">
            <span>Search runs</span>
            <div className="relative">
              {isSearching ? (
                <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              )}
              <Input
                className="h-10 w-full pl-9"
                placeholder="Search run inputs and outputs…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>Status filter</span>
            <select
              className="flex h-10 min-w-44 rounded-lg border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === "all"
                    ? "All statuses"
                    : status.replace(/[_-]+/g, " ")}
                </option>
              ))}
            </select>
          </label>
          {agents.length > 0 && (
            <Dialog
              open={newRunOpen}
              onOpenChange={(open) => {
                setNewRunOpen(open);
                if (!open) resetNewRun();
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" />
                  New Run
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Start a new agent run</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="run-agent">
                      Agent
                    </label>
                    <Select value={newRunAgentId} onValueChange={setNewRunAgentId}>
                      <SelectTrigger id="run-agent">
                        <SelectValue placeholder="Select an agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="run-message"
                    >
                      Message
                    </label>
                    <textarea
                      id="run-message"
                      rows={5}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="What should the agent do?"
                      value={newRunMessage}
                      onChange={(e) => setNewRunMessage(e.target.value)}
                    />
                  </div>
                  {newRunError ? (
                    <p className="text-sm text-destructive">{newRunError}</p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNewRunOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleNewRun()}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Start Run
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run monitor</CardTitle>
          <CardDescription>
            {isSearchActive
              ? "Showing full-text matches ranked by relevance. Click a row to inspect the full run."
              : "Click a row to inspect input, output, and any available step data."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredRuns}
            emptyMessage={
              isSearchActive
                ? "No runs match the current full-text search."
                : "No runs match the selected status."
            }
            onRowClick={(run) => router.push(`/runs/${run.id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
