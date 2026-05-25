"use client";

import { CheckIcon, GitCompareArrows, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";

import { EvolutionDiffModal } from "@/components/evolution-diff-modal";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createApiClient } from "@/lib/api";
import type { EvolutionCandidate } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";

interface Props {
  candidates: EvolutionCandidate[];
  isAdmin: boolean;
}

export function EvolutionCandidatesTable({ candidates: initial, isAdmin }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [diffCandidate, setDiffCandidate] = useState<EvolutionCandidate | null>(null);
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState<Record<string, "approving" | "rejecting">>({});

  const act = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (!session?.accessToken) return;
      const client = createApiClient(session.accessToken);
      setLoading((prev) => ({ ...prev, [id]: action === "approve" ? "approving" : "rejecting" }));

      try {
        if (action === "approve") {
          await client.admin.approveCandidate(id);
          setItems((prev) =>
            prev.map((c) => (c.id === id ? { ...c, approval_status: "approved" } : c)),
          );
        } else {
          await client.admin.rejectCandidate(id);
          setItems((prev) =>
            prev.map((c) => (c.id === id ? { ...c, approval_status: "rejected" } : c)),
          );
        }
        router.refresh();
      } catch {
        // keep state as-is on error
      } finally {
        setLoading((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [session, router],
  );

  return (
    <>
      {diffCandidate && (
        <EvolutionDiffModal
          candidate={diffCandidate}
          isAdmin={isAdmin}
          onClose={() => setDiffCandidate(null)}
          onApprove={async (id) => {
            await act(id, "approve");
          }}
          onReject={async (id) => {
            await act(id, "reject");
          }}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Eval score</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rationale</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No evolution candidates yet.
              </TableCell>
            </TableRow>
          ) : (
            items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">{shortId(c.id, 8)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{c.type}</Badge>
                </TableCell>
                <TableCell>
                  {c.eval_score != null ? (
                    <span className="font-medium">{(c.eval_score * 100).toFixed(0)}%</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.approval_status} />
                </TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                  {c.rationale ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.created_at ? formatDateTime(c.created_at) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {(c.current_content || c.proposed_content) && (
                      <Button
                        className="h-7 text-xs"
                        onClick={() => setDiffCandidate(c)}
                        size="sm"
                        variant="ghost"
                      >
                        <GitCompareArrows className="mr-1 size-3" />
                        Diff
                      </Button>
                    )}
                    {isAdmin && c.approval_status === "pending" ? (
                      <>
                        <Button
                          className="h-7 text-xs text-green-600 hover:text-green-700"
                          disabled={!!loading[c.id]}
                          onClick={() => act(c.id, "approve")}
                          size="sm"
                          variant="outline"
                        >
                          <CheckIcon className="mr-1 size-3" />
                          {loading[c.id] === "approving" ? "…" : "Approve"}
                        </Button>
                        <Button
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={!!loading[c.id]}
                          onClick={() => act(c.id, "reject")}
                          size="sm"
                          variant="outline"
                        >
                          <XIcon className="mr-1 size-3" />
                          {loading[c.id] === "rejecting" ? "…" : "Reject"}
                        </Button>
                      </>
                    ) : (
                      isAdmin && (
                        <span className="text-xs capitalize text-muted-foreground">
                          {c.approval_status}
                        </span>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
