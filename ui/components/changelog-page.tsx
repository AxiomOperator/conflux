"use client";

import {
  CheckCircle2,
  Minus,
  PlusCircle,
  RefreshCw,
  ScrollText,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChangeCategory, ChangelogRelease } from "@/lib/changelog";
import { cn } from "@/lib/utils";

const CATEGORY_CONFIG: Record<
  ChangeCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  feature: {
    label: "Feature",
    icon: Sparkles,
    className:
      "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800",
  },
  improvement: {
    label: "Improvement",
    icon: RefreshCw,
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  },
  added: {
    label: "Added",
    icon: PlusCircle,
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  },
  changed: {
    label: "Changed",
    icon: RefreshCw,
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  },
  fixed: {
    label: "Fixed",
    icon: CheckCircle2,
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  },
  removed: {
    label: "Removed",
    icon: Minus,
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  },
};

function CategoryBadge({ category }: { category: ChangeCategory }) {
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex min-w-28 shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.className,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

function ReleaseCard({ release }: { release: ChangelogRelease }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <CardTitle className="text-xl font-bold">
            v{release.version}
          </CardTitle>
          <span className="text-sm text-muted-foreground">{release.date}</span>
          <span className="text-sm text-muted-foreground">—</span>
          <span className="text-sm">{release.summary}</span>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {release.entries.map((entry) => (
            <li
              key={`${entry.category}-${entry.description}`}
              className="flex items-start gap-3"
            >
              <CategoryBadge category={entry.category} />
              <span className="text-sm leading-5 pt-0.5">
                {entry.description}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ChangelogPage({ releases }: { releases: ChangelogRelease[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Changelog</h1>
          <p className="text-sm text-muted-foreground">
            A running log of all features, fixes, and changes to Conflux.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        {(
          [
            "feature",
            "improvement",
            "added",
            "changed",
            "fixed",
            "removed",
          ] as ChangeCategory[]
        ).map((cat) => {
          const config = CATEGORY_CONFIG[cat];
          const Icon = config.icon;
          return (
            <span key={cat} className="flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {config.label}
            </span>
          );
        })}
      </div>

      <div className="space-y-4">
        {releases.map((release) => (
          <ReleaseCard key={release.version} release={release} />
        ))}
      </div>
    </div>
  );
}
