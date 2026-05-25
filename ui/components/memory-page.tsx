"use client";

import { Loader2, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useMemo, useState, useTransition } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
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
import { Input } from "@/components/ui/input";
import type { MemoryEntry } from "@/lib/api";
import { createApiClient } from "@/lib/api";
import { formatDateTime, truncate } from "@/lib/format";

export function MemoryPage({ entries: initialEntries }: { entries: MemoryEntry[] }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [entries, setEntries] = useState<MemoryEntry[]>(initialEntries);
  const [scopeFilter, setScopeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, startSearchTransition] = useTransition();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!session?.accessToken) return;
      const client = createApiClient(session.accessToken);
      startSearchTransition(async () => {
        try {
          if (query.trim()) {
            const results = await client.memory.search(query.trim());
            setEntries(results);
          } else {
            const [userEntries, sessionEntries, globalEntries] = await Promise.all([
              client.memory.list("user").catch(() => [] as MemoryEntry[]),
              client.memory.list("session").catch(() => [] as MemoryEntry[]),
              client.memory.list("global").catch(() => [] as MemoryEntry[]),
            ]);
            setEntries([...userEntries, ...sessionEntries, ...globalEntries]);
          }
        } catch {
          // keep current entries on error
        }
      });
    },
    [session?.accessToken],
  );

  const handleDelete = useCallback(
    async (memoryId: string) => {
      if (!session?.accessToken) return;
      setDeletingIds((prev) => new Set(prev).add(memoryId));
      try {
        await createApiClient(session.accessToken).memory.delete(memoryId);
        setEntries((prev) => prev.filter((e) => e.id !== memoryId));
        router.refresh();
      } catch {
        // silently ignore
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(memoryId);
          return next;
        });
      }
    },
    [session?.accessToken, router],
  );

  const filteredEntries = useMemo(
    () =>
      scopeFilter === "all"
        ? entries
        : entries.filter((entry) => entry.scope === scopeFilter),
    [entries, scopeFilter],
  );

  const columns = useMemo<DataTableColumn<MemoryEntry>[]>(
    () => [
      {
        header: "Content",
        key: "content",
        render: (entry) => (
          <div>
            <p className="font-medium">{truncate(entry.content, 84)}</p>
            {entry.key ? (
              <p className="text-sm text-muted-foreground">Key: {entry.key}</p>
            ) : null}
            {(entry.tags ?? []).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(entry.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ),
        sortable: true,
        sortValue: (entry) => entry.content,
      },
      {
        header: "Scope",
        key: "scope",
        render: (entry) => <StatusBadge status={entry.scope} />,
        sortable: true,
        sortValue: (entry) => entry.scope,
      },
      {
        header: "Importance",
        key: "importance",
        render: (entry) => entry.importance,
        sortable: true,
        sortValue: (entry) => entry.importance,
      },
      {
        header: "Created",
        key: "created_at",
        render: (entry) => formatDateTime(entry.created_at),
        sortable: true,
        sortValue: (entry) => entry.created_at,
      },
      {
        className: "w-[80px]",
        header: "",
        key: "actions",
        render: (entry) => (
          <Button
            variant="ghost"
            size="icon"
            disabled={deletingIds.has(entry.id)}
            onClick={() => handleDelete(entry.id)}
          >
            {deletingIds.has(entry.id) ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4 text-destructive" />
            )}
          </Button>
        ),
      },
    ],
    [deletingIds, handleDelete],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Browse, search, and delete persisted memory across user, session,
            and global scopes.
          </p>
        </div>
        <label className="space-y-2 text-sm font-medium">
          <span>Scope</span>
          <select
            className="flex h-10 min-w-44 rounded-lg border border-input bg-background px-3 text-sm"
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
          >
            <option value="all">All scopes</option>
            <option value="global">Global</option>
            <option value="session">Session</option>
            <option value="user">User</option>
          </select>
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Memory browser</CardTitle>
          <CardDescription>
            Search and manage the highest-value remembered context items.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            {isSearching ? (
              <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <Input
              className="pl-9"
              placeholder="Search memories by content, key, or tag…"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <DataTable
            columns={columns}
            data={filteredEntries}
            emptyMessage="No memory entries found for the selected scope."
          />
        </CardContent>
      </Card>
    </div>
  );
}
