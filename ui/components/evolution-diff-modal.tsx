"use client";

import { CheckIcon, GitCompareArrows, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EvolutionCandidate } from "@/lib/api";

interface Props {
  candidate: EvolutionCandidate;
  onClose: () => void;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
  isAdmin: boolean;
}

function diffLines(
  a: string,
  b: string,
): Array<{ type: "same" | "removed" | "added"; text: string }> {
  const aLines = a.split("\n");
  const bLines = b.split("\n");

  // Simple LCS-based diff (Myers-like, simplified)
  const result: Array<{ type: "same" | "removed" | "added"; text: string }> = [];
  const m = aLines.length;
  const n = bLines.length;

  // Build a simple diff using DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push({ type: "same", text: aLines[i] });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: "added", text: bLines[j] });
      j++;
    } else {
      result.push({ type: "removed", text: aLines[i] });
      i++;
    }
  }
  return result;
}

export function EvolutionDiffModal({ candidate, onClose, onApprove, onReject, isAdmin }: Props) {
  const [acting, setActing] = useState<"approving" | "rejecting" | null>(null);

  const current = candidate.current_content ?? "";
  const proposed = candidate.proposed_content ?? "";
  const diff = diffLines(current, proposed);

  const added = diff.filter((l) => l.type === "added").length;
  const removed = diff.filter((l) => l.type === "removed").length;

  const handleApprove = async () => {
    if (!onApprove) return;
    setActing("approving");
    try {
      await onApprove(candidate.id);
      onClose();
    } finally {
      setActing(null);
    }
  };

  const handleReject = async () => {
    if (!onReject) return;
    setActing("rejecting");
    try {
      await onReject(candidate.id);
      onClose();
    } finally {
      setActing(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-4" />
            Evolution diff
          </DialogTitle>
          <DialogDescription className="mt-1">{candidate.rationale}</DialogDescription>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline">{candidate.type}</Badge>
            {candidate.eval_score != null && (
              <Badge variant="secondary">
                {(candidate.eval_score * 100).toFixed(0)}% eval score
              </Badge>
            )}
            <span className="text-xs text-green-600 font-medium">+{added}</span>
            <span className="text-xs text-red-500 font-medium">-{removed}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4">
            {!current && !proposed ? (
              <p className="text-sm text-muted-foreground">No content available for diff.</p>
            ) : (
              <pre className="text-xs font-mono leading-5 whitespace-pre-wrap break-words">
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === "added"
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : line.type === "removed"
                          ? "bg-red-500/10 text-red-700 dark:text-red-400 line-through opacity-60"
                          : "text-muted-foreground"
                    }
                  >
                    <span className="select-none mr-2 opacity-40 w-3 inline-block">
                      {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                    </span>
                    {line.text || "\u00a0"}
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>

        {isAdmin && candidate.approval_status === "pending" && (
          <div className="px-6 py-4 border-t flex justify-end gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={!!acting}
              onClick={handleReject}
            >
              <XIcon className="mr-1.5 size-3.5" />
              {acting === "rejecting" ? "Rejecting…" : "Reject"}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={!!acting}
              onClick={handleApprove}
            >
              <CheckIcon className="mr-1.5 size-3.5" />
              {acting === "approving" ? "Approving…" : "Approve"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
