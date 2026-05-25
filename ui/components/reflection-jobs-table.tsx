"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReflectionJob } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";

interface Props {
  jobs: ReflectionJob[];
}

export function ReflectionJobsTable({ jobs }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">No reflection jobs found.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Memories</TableHead>
          <TableHead>Skills</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const isOpen = expanded.has(job.id);
          const hasDetail =
            (job.learned_memories?.length ?? 0) > 0 ||
            (job.drafted_skills?.length ?? 0) > 0 ||
            !!job.error;

          return (
            <Fragment key={job.id}>
              <TableRow
                className={hasDetail ? "cursor-pointer hover:bg-muted/50" : undefined}
                onClick={hasDetail ? () => toggle(job.id) : undefined}
              >
                <TableCell className="px-2">
                  {hasDetail ? (
                    isOpen ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs">{shortId(job.run_id, 10)}</span>
                    <Link
                      href={`/runs/${job.run_id}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {job.was_successful === true ? (
                      <CheckCircle2 className="size-3.5 text-green-500" />
                    ) : job.was_successful === false ? (
                      <XCircle className="size-3.5 text-destructive" />
                    ) : null}
                    <StatusBadge status={job.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={job.memories_count > 0 ? "default" : "outline"}>
                    {job.memories_count}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={job.skills_count > 0 ? "default" : "outline"}>
                    {job.skills_count}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {job.created_at ? formatDateTime(job.created_at) : "—"}
                </TableCell>
              </TableRow>

              {isOpen && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={6} className="p-0">
                    <div className="px-6 py-4 space-y-4">
                      {/* Error */}
                      {job.error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                          <p className="text-xs font-medium text-destructive mb-1">Error</p>
                          <p className="text-xs font-mono text-muted-foreground">{job.error}</p>
                        </div>
                      )}

                      {/* Learned memories */}
                      {(job.learned_memories?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <BookOpen className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Memories learned</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                              {job.learned_memories.length}
                            </Badge>
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {job.learned_memories.map((mem, i) => (
                              <div
                                key={i}
                                className="rounded-md border bg-card px-3 py-2 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                  <span className="font-medium truncate">{mem.key}</span>
                                  {mem.scope && (
                                    <Badge variant="secondary" className="text-[10px] px-1 h-4 shrink-0">
                                      {mem.scope}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-muted-foreground line-clamp-3">{mem.value}</p>
                                {(mem.tags?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {mem.tags!.map((t) => (
                                      <span
                                        key={t}
                                        className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Drafted skills */}
                      {(job.drafted_skills?.length ?? 0) > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Code2 className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Skills drafted</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                              {job.drafted_skills.length}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {job.drafted_skills.map((name, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
