'use client';

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';

interface TrajectoryMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string | null;
  tool_calls?: Array<Record<string, unknown>> | null;
  name?: string | null;
}

interface TrajectoryRecord {
  id: string;
  run_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  system_prompt?: string | null;
  messages: TrajectoryMessage[];
  message_count: number;
  status: string;
  quality_score: number | null;
  tags: string[];
  created_at: string | null;
  input_tokens: number;
  output_tokens: number;
}

interface TrajectoryListResponse {
  items: TrajectoryRecord[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 20;

function parseError(value: unknown, fallback: string) {
  if (value && typeof value === 'object' && 'detail' in value) {
    const detail = value.detail;
    if (typeof detail === 'string') {
      return detail;
    }
  }
  return fallback;
}

function formatRole(role: string) {
  return role
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function TrajectoriesPage({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<TrajectoryRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<TrajectoryRecord | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    if (!isAdmin) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const listParams = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (statusFilter !== 'all') {
        listParams.set('status', statusFilter);
      }

      const approvedParams = new URLSearchParams({ page: '1', limit: '1', status: 'approved' });
      const [listRes, approvedRes] = await Promise.all([
        fetch(`/api/admin/trajectories?${listParams.toString()}`, { cache: 'no-store' }),
        fetch(`/api/admin/trajectories?${approvedParams.toString()}`, { cache: 'no-store' }),
      ]);

      if (!listRes.ok) {
        const payload = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(parseError(payload, 'Failed to load trajectories.'));
      }

      const payload = (await listRes.json()) as TrajectoryListResponse;
      setItems(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setScoreDrafts((current) => {
        const next = { ...current };
        for (const item of payload.items ?? []) {
          next[item.id] = item.quality_score === null ? '' : String(item.quality_score);
        }
        return next;
      });

      if (approvedRes.ok) {
        const approvedPayload = (await approvedRes.json()) as TrajectoryListResponse;
        setApprovedTotal(approvedPayload.total ?? 0);
      } else {
        setApprovedTotal(0);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load trajectories.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, page, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  async function updateStatus(
    trajectoryId: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setWorkingId(trajectoryId);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'PUT',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(parseError(payload, 'Failed to update trajectory.'));
      }
      await loadData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update trajectory.');
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDelete(trajectoryId: string) {
    setWorkingId(trajectoryId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/trajectories/${trajectoryId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(parseError(payload, 'Failed to delete trajectory.'));
      }
      if (selected?.id === trajectoryId) {
        setSelected(null);
      }
      const nextTotal = total - 1;
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
      } else {
        await loadData();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete trajectory.');
    } finally {
      setWorkingId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/trajectories/export', { cache: 'no-store' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(parseError(payload, 'Failed to export trajectories.'));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'trajectories.jsonl';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export trajectories.');
    } finally {
      setExporting(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>
            This section is only available to Conflux administrators.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sign in with an admin account to review and export fine-tuning trajectories.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Trajectories</h1>
          <p className="text-sm text-muted-foreground">
            Review captured runs, approve training-quality samples, and export approved JSONL.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <p className="text-sm font-medium">Status</p>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending_review">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void handleExport()} disabled={approvedTotal < 1 || exporting}>
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export JSONL
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trajectory review queue</CardTitle>
          <CardDescription>
            {approvedTotal} approved trajectory{approvedTotal === 1 ? '' : 'ies'} ready for export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quality Score</TableHead>
                  <TableHead className="w-[320px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        Loading trajectories…
                      </span>
                    </TableCell>
                  </TableRow>
                ) : items.length > 0 ? (
                  items.map((trajectory) => (
                    <TableRow
                      key={trajectory.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(trajectory)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{trajectory.agent_name ?? 'Unknown agent'}</p>
                          <p className="text-xs text-muted-foreground">{trajectory.agent_id ?? 'No agent id'}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDateTime(trajectory.created_at)}</TableCell>
                      <TableCell>{trajectory.message_count}</TableCell>
                      <TableCell>
                        <StatusBadge status={trajectory.status} />
                      </TableCell>
                      <TableCell>
                        {trajectory.quality_score === null ? '—' : trajectory.quality_score.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex flex-wrap items-center gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {trajectory.status === 'pending_review' ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={workingId === trajectory.id}
                                onClick={() =>
                                  void updateStatus(
                                    trajectory.id,
                                    `/api/admin/trajectories/${trajectory.id}/approve`,
                                    { tags: trajectory.tags },
                                  )
                                }
                              >
                                {workingId === trajectory.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Check className="size-4 text-emerald-600" />
                                )}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={workingId === trajectory.id}
                                onClick={() =>
                                  void updateStatus(
                                    trajectory.id,
                                    `/api/admin/trajectories/${trajectory.id}/reject`,
                                  )
                                }
                              >
                                <X className="size-4 text-rose-600" />
                                Reject
                              </Button>
                            </>
                          ) : trajectory.status === 'approved' ? (
                            <>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                value={scoreDrafts[trajectory.id] ?? ''}
                                className="w-24"
                                onChange={(event) =>
                                  setScoreDrafts((current) => ({
                                    ...current,
                                    [trajectory.id]: event.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={workingId === trajectory.id}
                                onClick={() => {
                                  const rawScore = scoreDrafts[trajectory.id]?.trim() ?? '';
                                  const qualityScore = rawScore === '' ? null : Number(rawScore);
                                  if (rawScore !== '' && Number.isNaN(qualityScore)) {
                                    setError('Quality score must be a number.');
                                    return;
                                  }
                                  void updateStatus(
                                    trajectory.id,
                                    `/api/admin/trajectories/${trajectory.id}/approve`,
                                    { quality_score: qualityScore, tags: trajectory.tags },
                                  );
                                }}
                              >
                                {workingId === trajectory.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Save className="size-4" />
                                )}
                                Save
                              </Button>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">Rejected</span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={workingId === trajectory.id}
                            onClick={() => void handleDelete(trajectory.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No trajectories match the selected filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages} · {total} total trajectories
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selected?.agent_name ?? 'Trajectory details'}</DialogTitle>
            <DialogDescription>
              Inspect the full prompt and message thread before approving for fine-tuning.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selected?.status ?? 'unknown'} />
              <Badge variant="outline">{selected?.message_count ?? 0} messages</Badge>
              <Badge variant="outline">
                {selected?.input_tokens ?? 0} in / {selected?.output_tokens ?? 0} out tokens
              </Badge>
              {selected?.quality_score !== null && selected?.quality_score !== undefined ? (
                <Badge variant="outline">Score {selected.quality_score.toFixed(2)}</Badge>
              ) : null}
            </div>
            {selected?.system_prompt ? (
              <div className="space-y-2 rounded-xl border p-4">
                <p className="text-sm font-medium">System prompt</p>
                <pre className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {selected.system_prompt}
                </pre>
              </div>
            ) : null}
            <div className="space-y-3">
              {selected?.messages.map((message, index) => (
                <div key={`${selected.id}-${index}`} className="rounded-xl border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge variant="outline">{formatRole(message.role)}</Badge>
                    {message.name ? <Badge variant="outline">{message.name}</Badge> : null}
                    {message.tool_call_id ? (
                      <Badge variant="outline">Tool call {message.tool_call_id}</Badge>
                    ) : null}
                  </div>
                  {message.content ? (
                    <pre className="whitespace-pre-wrap break-words text-sm">
                      {message.content}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">No text content.</p>
                  )}
                  {message.tool_calls && message.tool_calls.length > 0 ? (
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                      {JSON.stringify(message.tool_calls, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
