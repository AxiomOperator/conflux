"use client";

import {
  ArchiveIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  Loader2Icon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  TrashIcon,
  Undo2Icon,
  Volume2Icon,
  VolumeXIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PersonalityPicker,
  type PersonalityState,
} from "@/components/personality-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useTts } from "@/hooks/use-tts";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sequence?: number;
  runId?: string | null;
  toolName?: string;
  isStreaming?: boolean;
};

type ToolEvent = {
  type: "tool_call" | "tool_result";
  name: string;
  args?: unknown;
  result?: unknown;
};

type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  message_count: number;
  last_message?: string | null;
  latest_run_id?: string | null;
  is_compressed?: boolean;
  compressed_at?: string | null;
};

type SlashCommandOption = {
  command: string;
  completion: string;
  description: string;
  example: string;
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res;
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function isSlashCommand(text: string, command: string) {
  return text === command || text.startsWith(`${command} `);
}

const SLASH_COMMANDS: SlashCommandOption[] = [
  {
    command: "/personality",
    completion: "/personality ",
    description: "Choose how the agent sounds.",
    example: "/personality concise",
  },
  {
    command: "/retry",
    completion: "/retry",
    description: "Retry the last agent response.",
    example: "/retry",
  },
  {
    command: "/undo",
    completion: "/undo",
    description: "Undo the latest exchange.",
    example: "/undo",
  },
];

// ──────────────────────────────────────────────────────────────
// Message renderer (basic markdown-like)
// ──────────────────────────────────────────────────────────────

function AssistantContent({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split("\n");
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert text-foreground leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("```")) {
          return <div key={i} className="font-mono text-xs bg-muted rounded px-2 py-0.5 my-1">{line}</div>;
        }
        if (line.startsWith("# ")) return <h3 key={i} className="font-semibold text-base mt-2">{line.slice(2)}</h3>;
        if (line.startsWith("## ")) return <h4 key={i} className="font-semibold text-sm mt-2">{line.slice(3)}</h4>;
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return <p key={i} className="ml-3 before:content-['•'] before:mr-2 before:text-muted-foreground">{line.slice(2)}</p>;
        }
        if (line.trim() === "") return <div key={i} className="h-2" />;
        return <p key={i}>{line}</p>;
      })}
      {streaming && (
        <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse rounded-sm ml-0.5" />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Tool call card
// ──────────────────────────────────────────────────────────────

function ToolCard({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground my-1">
      <WrenchIcon className="size-3 mt-0.5 shrink-0 text-orange-400" />
      <div className="flex-1">
        <button
          onClick={() => setOpen((p) => !p)}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
          <span className="font-medium">{event.name}</span>
          <span className="text-muted-foreground/60">
            {event.type === "tool_call" ? "called" : "→ result"}
          </span>
        </button>
        {open && (
          <pre className="mt-1 text-[11px] bg-muted/50 rounded p-2 overflow-x-auto max-h-32 whitespace-pre-wrap">
            {JSON.stringify(event.type === "tool_call" ? event.args : event.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Session list item
// ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || "New Chat");
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
      onClick={!editing ? onSelect : undefined}
    >
      <MessageSquareIcon className="size-4 shrink-0 mt-0.5 opacity-60" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm outline-none border-b border-primary"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraft(session.title ?? "New Chat"); setEditing(false); }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <p className="text-sm truncate">{session.title || "New Chat"}</p>
        )}
        {session.last_message && !editing && (
          <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
            {session.last_message}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[11px] text-muted-foreground/40" suppressHydrationWarning>
            {relativeTime(session.updated_at || session.created_at)}
          </p>
          {session.is_compressed && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Compressed
            </span>
          )}
        </div>
      </div>
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); setEditing(true); setTimeout(() => inputRef.current?.select(), 10); }}
          title="Rename"
        >
          <PencilIcon className="size-3" />
        </button>
        <button
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >
          <TrashIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main ChatPage component
// ──────────────────────────────────────────────────────────────

export function ChatPage({
  orchestratorId,
}: {
  orchestratorId: string | null | undefined;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [isPersonalityPickerOpen, setIsPersonalityPickerOpen] = useState(false);
  const [personality, setPersonality] = useState<PersonalityState>({ preset: null, presets: [] });

  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activePersonality = useMemo(
    () => personality.presets.find((preset) => preset.name === personality.preset) ?? null,
    [personality.preset, personality.presets],
  );
  const normalizedSlashInput = input.trimStart().toLowerCase();
  const slashSuggestions = useMemo(() => {
    if (!normalizedSlashInput.startsWith("/")) {
      return [] as SlashCommandOption[];
    }
    return SLASH_COMMANDS.filter((command) =>
      command.command.startsWith(normalizedSlashInput) ||
      normalizedSlashInput.startsWith(command.command),
    );
  }, [normalizedSlashInput]);

  // ── STT ──
  const voice = useVoiceRecorder({
    onTranscript: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
      textareaRef.current?.focus();
    },
  });

  // ── TTS ──
  const tts = useTts();
  const MicButtonIcon =
    voice.state === "recording"
      ? MicOffIcon
      : voice.state === "transcribing"
        ? Loader2Icon
        : MicIcon;

  // ── Load sessions ──
  const loadSessions = useCallback(async () => {
    try {
      const res = await apiFetch("/api/sessions");
      setSessions(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadPersonality = useCallback(async () => {
    try {
      const res = await apiFetch("/api/personality");
      const data = (await res.json()) as PersonalityState;
      setPersonality(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadPersonality();
  }, [loadPersonality]);

  // Clear speakingIdx when TTS finishes naturally
  useEffect(() => {
    if (tts.state === "idle") setSpeakingIdx(null);
  }, [tts.state]);

  // ── Load session messages ──
  const openSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setToolEvents([]);
    setLoadingSession(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}`);
      const data = await res.json() as {
        messages?: Array<ChatMessage & { run_id?: string | null }>;
        id?: string;
        title?: string;
        latest_run_id?: string | null;
        is_compressed?: boolean;
        compressed_at?: string | null;
      };
      const msgs = (data.messages ?? []).map((message) => ({
        ...message,
        runId: message.run_id ?? message.runId ?? null,
      }));
      setMessages(msgs.filter((m) => m.role === "user" || m.role === "assistant"));
      setSessions((prev) => prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: data.title ?? session.title,
              latest_run_id: data.latest_run_id ?? session.latest_run_id ?? null,
              is_compressed: Boolean(data.is_compressed),
              compressed_at: data.compressed_at ?? null,
            }
          : session,
      ));
    } catch {
      /* ignore */
    } finally {
      setLoadingSession(false);
    }
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Create new session ──
  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "New Chat" }),
      });
      const data = await res.json() as { id: string; title: string };
      const newSession: ChatSession = {
        id: data.id,
        title: data.title,
        created_at: new Date().toISOString(),
        message_count: 0,
        last_message: null,
        latest_run_id: null,
        is_compressed: false,
        compressed_at: null,
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(data.id);
      setMessages([]);
      setToolEvents([]);
      return data.id;
    } catch {
      return null;
    }
  }, []);

  const streamRun = useCallback(async (runId: string) => {
    let accumulated = "";

    await new Promise<void>((resolve) => {
      const es = new EventSource(`/api/runs/${runId}/stream`);
      esRef.current = es;

      es.addEventListener("token", (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as { content?: string };
          accumulated += d.content ?? "";
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: accumulated, isStreaming: true } : m,
            ),
          );
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("tool_call", (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as { name?: string; args?: unknown };
          setToolEvents((prev) => [...prev, { type: "tool_call", name: d.name ?? "tool", args: d.args }]);
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("tool_result", (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as { name?: string; result?: unknown };
          setToolEvents((prev) => [...prev, { type: "tool_result", name: d.name ?? "tool", result: d.result }]);
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("done", (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as { content?: string };
          if (!accumulated && d.content) {
            accumulated = d.content;
          }
        } catch {
          /* ignore */
        }
        es.close();
        esRef.current = null;
        resolve();
      });

      es.addEventListener("error", (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as { message?: string };
          accumulated += `\n\n[Error: ${d.message ?? "Unknown error"}]`;
        } catch {
          /* ignore */
        }
        es.close();
        esRef.current = null;
        resolve();
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null;
          resolve();
        }
      };
    });

    return accumulated;
  }, []);

  const findUserMessageForRun = useCallback((runId?: string | null, beforeIndex = messages.length) => {
    const candidates = messages.slice(0, beforeIndex);
    const exact = [...candidates].reverse().find((message) => message.role === "user" && message.runId === runId);
    if (exact) return exact;
    return [...candidates].reverse().find((message) => message.role === "user") ?? null;
  }, [messages]);

  const retryRun = useCallback(async (sourceRunId: string, userContent: string) => {
    if (!activeSessionId || !sourceRunId || isStreaming) return;
    const trimmedUser = userContent.trim();
    if (!trimmedUser) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmedUser },
      { role: "assistant", content: "", isStreaming: true },
    ]);
    setToolEvents([]);

    try {
      const res = await apiFetch(`/api/runs/${sourceRunId}/retry`, {
        method: "POST",
      });
      const data = await res.json() as { run_id: string };
      const runId = data.run_id;

      setMessages((prev) =>
        prev.map((message, index) =>
          index >= prev.length - 2 ? { ...message, runId } : message,
        ),
      );
      setIsStreaming(true);

      const accumulated = await streamRun(runId);
      setMessages((prev) =>
        prev.map((message, index) => {
          if (index === prev.length - 2 || index === prev.length - 1) {
            return {
              ...message,
              runId,
              isStreaming: index === prev.length - 1 ? false : message.isStreaming,
              content: index === prev.length - 1 ? accumulated : message.content,
            };
          }
          return message;
        }),
      );

      if (autoSpeak && accumulated.trim()) {
        tts.speak(accumulated);
      }

      await apiFetch(`/api/sessions/${activeSessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "user", content: trimmedUser },
            { role: "assistant", content: accumulated },
          ],
          run_id: runId,
        }),
      }).catch(() => {
        /* non-fatal */
      });

      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                message_count: (session.message_count || 0) + 2,
                last_message: accumulated.slice(0, 120),
                latest_run_id: runId,
                updated_at: new Date().toISOString(),
              }
            : session,
        ),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((message, index) =>
          index === prev.length - 1
            ? {
                ...message,
                content: `Failed to retry response: ${err instanceof Error ? err.message : String(err)}`,
                isStreaming: false,
              }
            : message,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [activeSessionId, autoSpeak, isStreaming, streamRun, tts]);

  const undoLastRun = useCallback(async () => {
    const runId = activeSession?.latest_run_id;
    if (!activeSessionId || !runId || isStreaming) return;

    try {
      await apiFetch(`/api/runs/${runId}/undo`, {
        method: "POST",
      });

      const remainingMessages = messages.filter((message) => message.runId !== runId);
      const removedCount = messages.length - remainingMessages.length;
      const latestVisibleRunId = [...remainingMessages].reverse().find(
        (message) => message.role === "assistant" && message.runId,
      )?.runId ?? null;
      const lastVisibleMessage = [...remainingMessages].reverse().find(
        (message) => message.role === "assistant" || message.role === "user",
      );

      setMessages(remainingMessages);
      setToolEvents([]);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                message_count: Math.max(0, (session.message_count || 0) - removedCount),
                last_message: lastVisibleMessage?.content?.slice(0, 120) ?? null,
                latest_run_id: latestVisibleRunId,
                updated_at: new Date().toISOString(),
              }
            : session,
        ),
      );
      void loadSessions();
    } catch (err) {
      if (typeof window !== "undefined") {
        window.alert(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [activeSession, activeSessionId, isStreaming, loadSessions, messages]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    if (!orchestratorId) return;

    setInput("");
    textareaRef.current?.focus();

    if (isSlashCommand(text, "/undo")) {
      await undoLastRun();
      return;
    }

    if (isSlashCommand(text, "/retry")) {
      const latestAssistant = [...messages].reverse().find(
        (message) => message.role === "assistant" && message.runId,
      );
      const sourceUser = latestAssistant ? findUserMessageForRun(latestAssistant.runId) : null;
      if (latestAssistant?.runId && sourceUser?.content) {
        await retryRun(latestAssistant.runId, sourceUser.content);
      }
      return;
    }

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await createSession();
      if (!sessionId) return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", isStreaming: true },
    ]);
    setToolEvents([]);

    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    history.push({ role: "user", content: text });

    try {
      const runRes = await apiFetch("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          agent_id: orchestratorId,
          messages: history,
          session_id: sessionId,
        }),
      });
      const runData = await runRes.json() as { run_id: string };
      const runId = runData.run_id;

      setMessages((prev) =>
        prev.map((message, index) =>
          index >= prev.length - 2 ? { ...message, runId } : message,
        ),
      );
      setIsStreaming(true);

      const accumulated = await streamRun(runId);
      setMessages((prev) =>
        prev.map((message, index) => {
          if (index === prev.length - 2 || index === prev.length - 1) {
            return {
              ...message,
              runId,
              isStreaming: index === prev.length - 1 ? false : message.isStreaming,
              content: index === prev.length - 1 ? accumulated : message.content,
            };
          }
          return message;
        }),
      );

      if (autoSpeak && accumulated.trim()) {
        tts.speak(accumulated);
      }

      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "user", content: text },
            { role: "assistant", content: accumulated },
          ],
          run_id: runId,
        }),
      }).catch(() => {
        /* non-fatal */
      });

      const currentSession = sessions.find((session) => session.id === sessionId);
      if (currentSession && (currentSession.message_count === 0 || currentSession.title === "New Chat")) {
        const autoTitle = text.length > 50 ? `${text.slice(0, 50)}…` : text;
        await apiFetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: autoTitle }),
        }).catch(() => {
          /* non-fatal */
        });
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  title: autoTitle,
                  message_count: (session.message_count || 0) + 2,
                  last_message: accumulated.slice(0, 120),
                  latest_run_id: runId,
                }
              : session,
          ),
        );
      } else {
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  message_count: (session.message_count || 0) + 2,
                  last_message: accumulated.slice(0, 120),
                  updated_at: new Date().toISOString(),
                  latest_run_id: runId,
                }
              : session,
          ),
        );
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((message, index) =>
          index === prev.length - 1
            ? {
                ...message,
                content: `Failed to get response: ${err instanceof Error ? err.message : String(err)}`,
                isStreaming: false,
              }
            : message,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [
    input,
    isStreaming,
    orchestratorId,
    activeSessionId,
    createSession,
    messages,
    sessions,
    autoSpeak,
    tts,
    undoLastRun,
    retryRun,
    findUserMessageForRun,
    streamRun,
  ]);

  const compressSession = useCallback(async () => {
    if (!activeSessionId || !activeSession?.latest_run_id || isCompressing) return;

    setIsCompressing(true);
    try {
      const res = await apiFetch(`/api/runs/${activeSession.latest_run_id}/compress`, {
        method: "POST",
      });
      const data = await res.json() as { summary: string; compressed_at: string };
      setSessions((prev) => prev.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              is_compressed: true,
              compressed_at: data.compressed_at,
            }
          : session,
      ));
      if (typeof window !== "undefined") {
        window.alert(`Conversation compressed.\n\nSummary:\n${data.summary}`);
      }
    } catch (err) {
      if (typeof window !== "undefined") {
        window.alert(`Compression failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setIsCompressing(false);
    }
  }, [activeSession, activeSessionId, isCompressing]);

  // ── Delete session ──
  const deleteSession = useCallback(async (sessionId: string) => {
    await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" }).catch(() => { /* ignore */ });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
      setToolEvents([]);
    }
  }, [activeSessionId]);

  // ── Rename session ──
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    await apiFetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }).catch(() => { /* ignore */ });
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
  }, []);

  // ── Copy message ──
  const copyMessage = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content).catch(() => { /* ignore */ });
    setCopiedId(String(idx));
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const acceptSlashSuggestion = useCallback((completion: string) => {
    setInput(completion);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(completion.length, completion.length);
    });
  }, []);

  // ── Keyboard handler ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab" && slashSuggestions.length > 0) {
        e.preventDefault();
        acceptSlashSuggestion(slashSuggestions[0]?.completion ?? "/personality ");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [acceptSlashSuggestion, sendMessage, slashSuggestions],
  );

  // ── Auto-resize textarea ──
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const noOrchestrator = !orchestratorId;

  return (
    <div className="flex h-full overflow-hidden -mx-4 -my-6 md:-mx-6">
      {/* ── Left: session sidebar ── */}
      <aside className="w-64 shrink-0 flex flex-col border-r bg-muted/20">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => createSession()}
            title="New chat"
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No conversations yet.
              <br />
              Start a new chat!
            </p>
          )}
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onSelect={() => openSession(s.id)}
              onDelete={() => deleteSession(s.id)}
              onRename={(title) => renameSession(s.id, title)}
            />
          ))}
        </div>
      </aside>

      {/* ── Right: conversation ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* No orchestrator warning */}
        {noOrchestrator && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm space-y-3">
              <BotIcon className="size-12 mx-auto text-muted-foreground/40" />
              <p className="text-lg font-semibold">No orchestrator agent found</p>
              <p className="text-sm text-muted-foreground">
                Your personal workspace doesn&apos;t have an orchestrator agent yet.
                Visit the <strong>Agents</strong> page and create one with type{" "}
                <code className="bg-muted px-1 rounded">orchestrator</code>.
              </p>
            </div>
          </div>
        )}

        {/* Empty state — no active session */}
        {!noOrchestrator && !activeSessionId && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm space-y-4">
              <div className="size-16 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto">
                <MessageSquareIcon className="size-8 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-xl font-semibold">Start a conversation</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose a conversation from the left or start a new one. Your agent has memory, tools, and your persona.
                </p>
              </div>
              <Button onClick={() => createSession()} className="gap-2">
                <PlusIcon className="size-4" />
                New Chat
              </Button>
            </div>
          </div>
        )}

        {/* Active conversation */}
        {!noOrchestrator && activeSessionId && (
          <>
            <div className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{activeSession?.title || "New Chat"}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
                    {activePersonality && (
                      <Badge variant="outline" className="px-2 py-0 text-[10px]">
                        {activePersonality.label}
                      </Badge>
                    )}
                    {activeSession?.is_compressed && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                        Compressed{activeSession.compressed_at ? ` · ${relativeTime(activeSession.compressed_at)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setIsPersonalityPickerOpen(true)}
                    disabled={loadingSession}
                  >
                    <SparklesIcon className="size-4" />
                    Personality
                  </Button>
                  {messages.length >= 5 && activeSession?.latest_run_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => void compressSession()}
                      disabled={isStreaming || loadingSession || isCompressing}
                    >
                      {isCompressing ? <Loader2Icon className="size-4 animate-spin" /> : <ArchiveIcon className="size-4" />}
                      {activeSession.is_compressed ? "Recompress" : "Compress"}
                    </Button>
                  )}
                </div>
              </div>
              {activeSession?.is_compressed && (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  Future turns start from the saved summary instead of replaying the full conversation.
                </p>
              )}
            </div>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
              {loadingSession && (
                <div className="flex justify-center">
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {messages.length === 0 && !loadingSession && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-2 text-muted-foreground/50 py-16">
                  <BotIcon className="size-10" />
                  <p className="text-sm">Send a message to begin</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex w-full",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] group relative",
                      msg.role === "user" && "max-w-[60%]",
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="size-5 rounded-full bg-primary/10 flex items-center justify-center">
                          <BotIcon className="size-3 text-primary" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">Agent</span>
                      </div>
                    )}

                    {/* Tool events before this assistant message */}
                    {msg.role === "assistant" && idx === messages.length - 1 && toolEvents.length > 0 && (
                      <div className="mb-2 space-y-0.5">
                        {toolEvents.map((ev, ti) => (
                          <ToolCard key={ti} event={ev} />
                        ))}
                      </div>
                    )}

                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 text-sm",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted/60 text-foreground rounded-bl-sm",
                      )}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <AssistantContent text={msg.content} streaming={msg.isStreaming} />
                      )}
                    </div>

                    {/* Message actions */}
                    {!msg.isStreaming && msg.content && (
                      <div className={cn(
                        "absolute top-0 hidden group-hover:flex items-center gap-1",
                        msg.role === "user" ? "-left-16" : "-right-16",
                      )}>
                        {/* Speak button (assistant only) */}
                        {msg.role === "assistant" && tts.supported && (
                          <button
                            className={cn(
                              "p-1 rounded hover:bg-muted transition-colors",
                              speakingIdx === idx
                                ? "text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => {
                              if (speakingIdx === idx) {
                                tts.stop();
                                setSpeakingIdx(null);
                              } else {
                                tts.stop();
                                setSpeakingIdx(idx);
                                tts.speak(msg.content);
                              }
                            }}
                            title={speakingIdx === idx ? "Stop speaking" : "Read aloud"}
                          >
                            {speakingIdx === idx ? (
                              <VolumeXIcon className="size-3" />
                            ) : (
                              <Volume2Icon className="size-3" />
                            )}
                          </button>
                        )}
                        {msg.role === "assistant" && msg.runId && (
                          <button
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                              const runId = msg.runId;
                              if (!runId) return;
                              const sourceUser = findUserMessageForRun(runId, idx);
                              if (sourceUser?.content) {
                                void retryRun(runId, sourceUser.content);
                              }
                            }}
                            title="Retry"
                            disabled={isStreaming}
                          >
                            <RotateCcwIcon className="size-3" />
                          </button>
                        )}
                        <button
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => copyMessage(msg.content, idx)}
                          title="Copy"
                        >
                          {copiedId === String(idx) ? (
                            <CheckIcon className="size-3 text-green-500" />
                          ) : (
                            <CopyIcon className="size-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="border-t p-4">
              {slashSuggestions.length > 0 && (
                <div className="mb-3 rounded-2xl border bg-background/95 p-2 shadow-sm">
                  {slashSuggestions.map((command) => (
                    <button
                      key={command.command}
                      className="flex w-full items-start justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70"
                      onClick={() => acceptSlashSuggestion(command.completion)}
                      type="button"
                    >
                      <div>
                        <p className="text-sm font-medium">{command.command}</p>
                        <p className="text-xs text-muted-foreground">{command.description}</p>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        <div>{command.example}</div>
                        <div className="mt-1">Tab to autocomplete</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-3 bg-muted/40 rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 min-h-[24px] max-h-[200px]"
                  placeholder="Message your agent… (Enter to send, Shift+Enter for newline)"
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                />
                <div className="flex items-center gap-2 shrink-0">
                  {/* Auto-speak toggle + voice selector */}
                  {tts.supported && (
                    <div className="flex items-center">
                      <button
                        className={cn(
                          "p-1.5 rounded-l-lg transition-colors",
                          autoSpeak
                            ? "text-primary bg-primary/10 hover:bg-primary/20"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                        onClick={() => { setAutoSpeak((v) => !v); if (autoSpeak) tts.stop(); }}
                        title={autoSpeak ? "Auto-speak on (click to disable)" : "Auto-speak off (click to enable)"}
                      >
                        <Volume2Icon className="size-4" />
                      </button>
                      {tts.voices.length > 0 && (
                        <select
                          className={cn(
                            "text-xs rounded-r-lg border-l border-border/30 bg-transparent h-7 pl-1 pr-0.5 outline-none cursor-pointer transition-colors max-w-[80px]",
                            autoSpeak
                              ? "text-primary bg-primary/5"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          value={tts.selectedVoice}
                          onChange={(e) => tts.setSelectedVoice(e.target.value)}
                          title="Select voice"
                        >
                          {tts.voices.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {/* Mic (STT) button */}
                  <button
                    className={cn(
                      "p-1.5 rounded-lg transition-colors",
                      voice.state === "recording"
                        ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                        : voice.state === "error"
                          ? "text-destructive"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    onClick={() => voice.toggle()}
                    disabled={voice.state === "transcribing" || isStreaming}
                    title={
                      voice.state === "recording"
                        ? "Stop recording"
                        : voice.state === "transcribing"
                          ? "Transcribing…"
                          : "Speak your message"
                    }
                  >
                    <MicButtonIcon
                      className={cn(
                        "size-4",
                        voice.state === "transcribing" && "animate-spin",
                      )}
                    />
                  </button>

                  <button
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    onClick={() => void undoLastRun()}
                    disabled={!activeSession?.latest_run_id || isStreaming || loadingSession}
                    title="Undo last exchange"
                  >
                    <Undo2Icon className="size-4" />
                  </button>
                  {isStreaming && (
                    <button
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { esRef.current?.close(); setIsStreaming(false); }}
                      title="Stop"
                    >
                      <XIcon className="size-4" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0 rounded-xl"
                    onClick={sendMessage}
                    disabled={!input.trim() || isStreaming}
                  >
                    {isStreaming ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <SendIcon className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/40 text-center mt-2">
                Powered by your personal Conflux orchestrator · has memory & tools
              </p>
            </div>
          </>
        )}
        <PersonalityPicker
          open={isPersonalityPickerOpen}
          onOpenChange={setIsPersonalityPickerOpen}
          currentPreset={personality.preset}
          presets={personality.presets}
          onApplied={setPersonality}
        />
      </div>
    </div>
  );
}
