"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  Loader2,
  Terminal,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgentRun } from "@/lib/api";
import { formatDateTime, formatDuration, shortId } from "@/lib/format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function elapsedSeconds(startedAt?: string | null) {
  if (!startedAt) return 0;
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown; call_id?: string }
  | { type: "status"; status: string; iteration: number }
  | { type: "error"; message: string }
  | { type: "done"; content?: string };

interface StoredEvent {
  id: string;
  event_type: string;
  sequence: number;
  payload: Record<string, unknown>;
  created_at: string | null;
}

interface ToolCallPair {
  call: { name: string; args: unknown; created_at?: string | null };
  result?: { result: unknown; created_at?: string | null };
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-7 shrink-0"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// ToolCallTree
// ---------------------------------------------------------------------------

function ToolCallTree({ pairs }: { pairs: ToolCallPair[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  if (!pairs.length) return null;

  return (
    <div className="space-y-2">
      {pairs.map((pair, i) => {
        const open = expanded[i] ?? false;
        return (
          <div key={i} className="rounded-lg border text-xs">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
              onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
            >
              {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                tool_call
              </span>
              <span className="font-mono font-semibold">{pair.call.name}</span>
              {pair.result && (
                <span className="ml-auto rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-950 dark:text-green-300">
                  ✓ result
                </span>
              )}
            </button>
            {open && (
              <div className="border-t px-3 py-2 space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">Arguments</span>
                    <CopyButton text={JSON.stringify(pair.call.args, null, 2)} />
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs leading-5">
                    {JSON.stringify(pair.call.args, null, 2)}
                  </pre>
                </div>
                {pair.result && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">Result</span>
                      <CopyButton text={JSON.stringify(pair.result.result, null, 2)} />
                    </div>
                    <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs leading-5">
                      {JSON.stringify(pair.result.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pair helper: combine tool_call + tool_result stream events
// ---------------------------------------------------------------------------

function pairToolEvents(events: StreamEvent[]): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];
  const pendingByName: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type === "tool_call") {
      const idx = pairs.length;
      pendingByName[ev.name] = idx;
      pairs.push({ call: { name: ev.name, args: ev.args } });
    } else if (ev.type === "tool_result") {
      const idx = pendingByName[ev.name];
      if (idx !== undefined) {
        pairs[idx].result = { result: ev.result };
        delete pendingByName[ev.name];
      } else {
        pairs.push({
          call: { name: ev.name, args: undefined },
          result: { result: ev.result },
        });
      }
    }
  }
  return pairs;
}

function pairStoredEvents(events: StoredEvent[]): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];
  const pendingByCallId: Record<string, number> = {};
  const pendingByName: Record<string, number> = {};

  for (const ev of events) {
    if (ev.event_type === "tool_call") {
      const name = (ev.payload.name as string) ?? "unknown";
      const callId = (ev.payload.call_id as string) ?? "";
      const idx = pairs.length;
      if (callId) pendingByCallId[callId] = idx;
      else pendingByName[name] = idx;
      pairs.push({ call: { name, args: ev.payload.args, created_at: ev.created_at } });
    } else if (ev.event_type === "tool_result") {
      const name = (ev.payload.name as string) ?? "unknown";
      const callId = (ev.payload.call_id as string) ?? "";
      const idx = callId !== undefined ? pendingByCallId[callId] : pendingByName[name];
      if (idx !== undefined) {
        pairs[idx].result = { result: ev.payload.result, created_at: ev.created_at };
        if (callId) delete pendingByCallId[callId];
        else delete pendingByName[name];
      } else {
        pairs.push({
          call: { name, args: undefined },
          result: { result: ev.payload.result, created_at: ev.created_at },
        });
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunDetailPage({
  run: initialRun,
  agentName,
}: {
  run: AgentRun;
  agentName: string;
}) {
  const [run, setRun] = useState(initialRun);
  const [streamText, setStreamText] = useState("");
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [storedEvents, setStoredEvents] = useState<StoredEvent[]>([]);
  const outputRef = useRef<HTMLPreElement | null>(null);

  const isLive = run.status === "queued" || run.status === "running";

  // Elapsed timer during live runs
  useEffect(() => {
    if (!isLive) return;
    setElapsed(elapsedSeconds(run.started_at));
    const id = setInterval(() => setElapsed(elapsedSeconds(run.started_at)), 1000);
    return () => clearInterval(id);
  }, [isLive, run.started_at]);

  // SSE stream for live runs
  useEffect(() => {
    if (!isLive) return;

    setStreaming(true);
    const es = new EventSource(`/api/runs/${run.id}/stream`);

    es.addEventListener("token", (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { content?: string };
        setStreamText((prev) => prev + (data.content ?? ""));
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("tool_call", (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { name?: string; args?: unknown };
        setStreamEvents((prev) => [
          ...prev,
          { type: "tool_call", name: data.name ?? "unknown", args: data.args },
        ]);
      } catch { /* ignore */ }
    });

    es.addEventListener("tool_result", (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { name?: string; result?: unknown };
        setStreamEvents((prev) => [
          ...prev,
          { type: "tool_result", name: data.name ?? "unknown", result: data.result },
        ]);
      } catch { /* ignore */ }
    });

    es.addEventListener("status", (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { status?: string; iteration?: number };
        setStreamEvents((prev) => [
          ...prev,
          { type: "status", status: data.status ?? "", iteration: data.iteration ?? 0 },
        ]);
      } catch { /* ignore */ }
    });

    es.addEventListener("done", () => {
      setStreaming(false);
      setRun((prev) => ({ ...prev, status: "completed" }));
      es.close();
    });

    es.addEventListener("error", (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { message?: string };
        setStreamEvents((prev) => [
          ...prev,
          { type: "error", message: data.message ?? "Unknown error" },
        ]);
      } catch { /* ignore */ }
      setStreaming(false);
      setRun((prev) => ({ ...prev, status: "failed" }));
      es.close();
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreaming(false);
        setRun((prev) =>
          prev.status === "queued" || prev.status === "running"
            ? { ...prev, status: "failed" }
            : prev,
        );
      }
    };

    return () => { es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // Fetch stored events for completed/failed runs
  useEffect(() => {
    if (isLive) return;
    void fetch(`/api/runs/${run.id}/events`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: StoredEvent[]) => setStoredEvents(data))
      .catch(() => { /* ignore */ });
  }, [run.id, isLive]);

  const tokenUsage = run.token_usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null | undefined;

  const hasTokens =
    tokenUsage &&
    (tokenUsage.prompt_tokens || tokenUsage.completion_tokens || tokenUsage.total_tokens);

  const streamToolPairs = pairToolEvents(streamEvents);
  const storedToolPairs = pairStoredEvents(storedEvents);
  const toolPairs = isLive ? streamToolPairs : storedToolPairs;

  type StatusEventItem = { type: "status"; status: string; iteration: number; created_at?: string | null };

  const statusEvents: StatusEventItem[] = isLive
    ? (streamEvents.filter((e) => e.type === "status") as Extract<StreamEvent, { type: "status" }>[]).map((e) => ({
        type: "status" as const,
        status: e.status,
        iteration: e.iteration,
      }))
    : storedEvents
        .filter((e) => e.event_type === "status")
        .map((e) => ({
          type: "status" as const,
          status: (e.payload.status as string) ?? "",
          iteration: (e.payload.iteration as number) ?? 0,
          created_at: e.created_at,
        }));

  const errorEvent = isLive
    ? (streamEvents.find((e) => e.type === "error") as Extract<StreamEvent, { type: "error" }> | undefined)
    : storedEvents
        .filter((e) => e.event_type === "error")
        .map((e) => ({ message: (e.payload.message as string) ?? "Unknown error" }))[0];

  const inputText = stringifyValue(run.raw_input ?? run.input);
  const outputText = stringifyValue(run.raw_output ?? run.output);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" asChild className="mb-2 -ml-3 w-fit">
            <Link href="/runs">
              <ArrowLeft className="size-4" />
              Back to runs
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">
            Run {shortId(run.id, 12)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Inspect payloads, timing, and execution output for this run.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {streaming && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Running…
            </span>
          )}
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Agent</CardTitle>
          </CardHeader>
          <CardContent className="font-medium">{agentName}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Created</CardTitle>
          </CardHeader>
          <CardContent className="font-medium">{formatDateTime(run.created_at)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" />
              {isLive ? "Elapsed" : "Duration"}
            </CardTitle>
          </CardHeader>
          <CardContent className="font-medium font-mono">
            {isLive
              ? formatElapsed(elapsed)
              : formatDuration(run.started_at, run.completed_at)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Started</CardTitle>
          </CardHeader>
          <CardContent className="font-medium">{formatDateTime(run.started_at)}</CardContent>
        </Card>
      </div>

      {/* Token usage */}
      {hasTokens && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Coins className="size-3.5" />
                Prompt tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-lg font-semibold">
              {(tokenUsage!.prompt_tokens ?? 0).toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Coins className="size-3.5" />
                Completion tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-lg font-semibold">
              {(tokenUsage!.completion_tokens ?? 0).toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Coins className="size-3.5" />
                Total tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-lg font-semibold">
              {(tokenUsage!.total_tokens ?? 0).toLocaleString()}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error card */}
      {run.status === "failed" && errorEvent && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              Run failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{errorEvent.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Live token stream */}
      {(isLive || streamText) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-amber-500" />
              Live output
              {streaming && (
                <span className="inline-block size-2 animate-pulse rounded-full bg-green-500" />
              )}
            </CardTitle>
            <CardDescription>Tokens streaming in real-time from the agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              ref={outputRef}
              className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs leading-6 whitespace-pre-wrap"
            >
              {streamText || (streaming ? "Waiting for tokens…" : "—")}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Tool call tree */}
      {toolPairs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4" />
              Tool calls
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                {toolPairs.length}
              </span>
            </CardTitle>
            <CardDescription>
              Expand each call to view arguments and results.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolCallTree pairs={toolPairs} />
          </CardContent>
        </Card>
      )}

      {/* Iteration timeline */}
      {statusEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" />
              Iteration timeline
            </CardTitle>
            <CardDescription>Status checkpoints recorded during the run.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative border-l border-muted-foreground/20 pl-5 space-y-3">
              {statusEvents.map((ev, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[1.15rem] mt-0.5 flex size-3 items-center justify-center rounded-full border border-muted-foreground/30 bg-background" />
                  <span className="font-medium">
                    Iter {ev.iteration}
                  </span>
                  <span className="ml-2 text-muted-foreground">{ev.status}</span>
                  {"created_at" in ev && (ev as { created_at?: string | null }).created_at && (
                    <span className="ml-2 text-xs text-muted-foreground/60">
                      {formatDateTime((ev as { created_at: string }).created_at)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Input / Output */}
      {!isLive && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Input</CardTitle>
                  <CardDescription>Original request payload.</CardDescription>
                </div>
                <CopyButton text={inputText} />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs leading-6 whitespace-pre-wrap">
                {inputText}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Output</CardTitle>
                  <CardDescription>Final output returned by the agent.</CardDescription>
                </div>
                <CopyButton text={outputText} />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs leading-6 whitespace-pre-wrap">
                {outputText}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
