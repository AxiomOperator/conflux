import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const toneMap: Record<string, string> = {
  active:
    "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300",
  approved:
    "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300",
  completed:
    "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300",
  healthy:
    "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300",
  running:
    "border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:text-sky-300",
  queued:
    "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  pending:
    "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  pending_review:
    "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  draft:
    "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  user: "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-500/30 dark:text-blue-300",
  session:
    "border-violet-200 bg-violet-500/10 text-violet-700 dark:border-violet-500/30 dark:text-violet-300",
  global:
    "border-cyan-200 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:text-cyan-300",
  idle: "border-zinc-200 bg-zinc-500/10 text-zinc-700 dark:border-zinc-500/30 dark:text-zinc-300",
  paused:
    "border-zinc-200 bg-zinc-500/10 text-zinc-700 dark:border-zinc-500/30 dark:text-zinc-300",
  unknown:
    "border-zinc-200 bg-zinc-500/10 text-zinc-700 dark:border-zinc-500/30 dark:text-zinc-300",
  rejected:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
  deprecated:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
  error:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
  failed:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
  cancelled:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
  unhealthy:
    "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300",
};

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({
  compact = false,
  status,
}: {
  compact?: boolean;
  status: string;
}) {
  const normalized = status.toLowerCase();

  return (
    <Badge
      className={cn(
        toneMap[normalized] ?? toneMap.unknown,
        compact ? "px-2 py-0 text-[11px]" : "px-2.5 py-0.5",
      )}
    >
      {humanize(normalized)}
    </Badge>
  );
}
