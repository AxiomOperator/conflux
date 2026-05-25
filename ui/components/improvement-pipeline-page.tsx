"use client";

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  type LucideIcon,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDateTime,
  shortId,
  truncate as truncateText,
} from "@/lib/format";
import { cn } from "@/lib/utils";

interface ImprovementPattern {
  id: string;
  detected_at: string;
  pattern_type: string;
  skill_id: string | null;
  frequency: number;
  severity: number | null;
  is_systemic: boolean;
  description: string;
  example_run_ids: string[];
  evidence: Record<string, unknown>;
  status: string;
}

interface EvolutionCandidate {
  id: string;
  created_at: string;
  updated_at: string;
  skill_id: string | null;
  candidate_type: string;
  current_content: string;
  proposed_content: string;
  rationale: string | null;
  eval_score: number | null;
  approval_status: string;
  decision: string | null;
  decision_reason: string | null;
  comparison_scores: Record<string, number> | null;
  test_results: Record<string, unknown> | null;
  detected_pattern: string | null;
  pattern_id: string | null;
}

interface EvalCase {
  id: string;
  created_at: string;
  skill_id: string | null;
  case_type: string;
  description: string;
  input_context: Record<string, unknown>;
  expected_behavior: string;
  acceptance_criteria: string | null;
  source: string;
  is_active: boolean;
  tags: string[];
}

interface SkillEvalRecord {
  id: string;
  created_at: string;
  run_id: string;
  skill_id: string;
  skill_version: number | null;
  task_context: string | null;
  dimensions_improved: string[];
  negative_effects: string | null;
  counterfactual_worse: boolean | null;
  evidence_strength: number | null;
  did_improve: boolean | null;
  improvement_detail: string | null;
  recommendation: string;
  eval_notes: string | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

type TabKey = "patterns" | "candidates" | "skill-evals" | "eval-cases";
type ToastTone = "success" | "error";

type PatternStatusAction = "acknowledged" | "resolved" | "ignored";
type CandidateDecision = "promote" | "reject" | "quarantine";
type CaseType =
  | "failure"
  | "success"
  | "edge_case"
  | "regression"
  | "performance";

interface ToastState {
  title: string;
  tone?: ToastTone;
}

interface SummaryCardProps {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}

interface PaginationControlsProps {
  page: number;
  pageCount: number;
  total: number;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

interface AddCaseFormState {
  description: string;
  caseType: CaseType;
  inputContext: string;
  expectedBehavior: string;
  acceptanceCriteria: string;
  tags: string;
  skillId: string;
}

const PAGE_SIZE = 20;
const ALL_VALUE = "ALL";
const booleanOptions = [
  { value: ALL_VALUE, label: "All" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
] as const;
const candidateDecisionOptions: CandidateDecision[] = [
  "promote",
  "reject",
  "quarantine",
];
const evalCaseTypeOptions: CaseType[] = [
  "failure",
  "success",
  "edge_case",
  "regression",
  "performance",
];
const reviewedPatternStatuses = new Set([
  "acknowledged",
  "resolved",
  "ignored",
]);
const numberFormatter = new Intl.NumberFormat("en-US");
const emptyAddCaseForm: AddCaseFormState = {
  description: "",
  caseType: "failure",
  inputContext: "{}",
  expectedBehavior: "",
  acceptanceCriteria: "",
  tags: "",
  skillId: "",
};

function readErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const payload = data as {
    detail?: unknown;
    error?: unknown;
    message?: unknown;
  };

  if (typeof payload.detail === "string") {
    return payload.detail;
  }
  if (typeof payload.error === "string") {
    return payload.error;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return fallback;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, fallback));
  }
  return payload as T;
}

function humanize(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function prettyJson(value: unknown) {
  if (value == null) {
    return "None";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMetric(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function mergeOptions(
  current: string[],
  incoming: Array<string | null | undefined>,
  pinned: string[] = [],
) {
  return Array.from(
    new Set([
      ...pinned,
      ...current,
      ...incoming
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ]),
  ).sort((left, right) => left.localeCompare(right));
}

function rangeKeys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function badgeClass(value: string | null | undefined) {
  const normalized = value?.toLowerCase() ?? "";

  if (
    [
      "promote",
      "promoted",
      "resolved",
      "approved",
      "active",
      "improved",
      "success",
      "true",
    ].includes(normalized)
  ) {
    return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300";
  }

  if (
    [
      "reject",
      "rejected",
      "failed",
      "error",
      "inactive",
      "ignored",
      "false",
    ].includes(normalized)
  ) {
    return "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:text-rose-300";
  }

  if (
    ["quarantine", "quarantined", "pending", "queued", "reviewing"].includes(
      normalized,
    )
  ) {
    return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300";
  }

  if (["new", "acknowledged", "detected", "recommended"].includes(normalized)) {
    return "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-500/30 dark:text-blue-300";
  }

  return "border-zinc-200 bg-zinc-500/10 text-zinc-700 dark:border-zinc-500/30 dark:text-zinc-300";
}

function SummaryCard({
  label,
  value,
  description,
  icon: Icon,
}: SummaryCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-3xl">{value}</CardTitle>
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function SummarySkeletons({ count = 4 }: { count?: number }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {rangeKeys("summary", count).map((key) => (
        <Card key={key}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-24" />
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

function InlineAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function StatusBadge({ value }: { value: string | null | undefined }) {
  return (
    <Badge variant="outline" className={cn("font-medium", badgeClass(value))}>
      {humanize(value)}
    </Badge>
  );
}

function PaginationControls({
  page,
  pageCount,
  total,
  loading,
  onPrevious,
  onNext,
}: PaginationControlsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Page {page} of {pageCount} ({numberFormatter.format(total)} total)
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={page <= 1 || loading}
        >
          <ChevronLeft className="mr-1 size-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= pageCount || loading}
        >
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
      {prettyJson(value)}
    </pre>
  );
}

function ComparisonScores({
  scores,
}: {
  scores: Record<string, number> | null;
}) {
  const entries = Object.entries(scores ?? {});
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No comparison scores recorded.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(([label, value]) => {
        const width = Math.max(
          4,
          Math.min(value <= 1 ? value * 100 : value, 100),
        );
        return (
          <div key={label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{humanize(label)}</span>
              <span>{formatMetric(value)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-blue-500"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ImprovementPipelinePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("patterns");
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [runningCycle, setRunningCycle] = useState(false);

  const [patternsData, setPatternsData] =
    useState<PaginatedResponse<ImprovementPattern> | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [patternsRefreshing, setPatternsRefreshing] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [patternsPage, setPatternsPage] = useState(1);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(
    null,
  );
  const [patternStatusOptions, setPatternStatusOptions] = useState<string[]>([
    "acknowledged",
    "ignored",
    "resolved",
  ]);
  const [patternTypeOptions, setPatternTypeOptions] = useState<string[]>([]);
  const [patternFilters, setPatternFilters] = useState({
    status: ALL_VALUE,
    patternType: ALL_VALUE,
  });
  const [patternActionId, setPatternActionId] = useState<string | null>(null);

  const [candidatesData, setCandidatesData] =
    useState<PaginatedResponse<EvolutionCandidate> | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesRefreshing, setCandidatesRefreshing] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesPage, setCandidatesPage] = useState(1);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(
    null,
  );
  const [candidateApprovalOptions, setCandidateApprovalOptions] = useState<
    string[]
  >([]);
  const [candidateFilters, setCandidateFilters] = useState({
    decision: ALL_VALUE,
    approvalStatus: ALL_VALUE,
  });
  const [decisionDialogOpen, setDecisionDialogOpen] = useState(false);
  const [decisionCandidate, setDecisionCandidate] =
    useState<EvolutionCandidate | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<CandidateDecision>("promote");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [skillEvalsData, setSkillEvalsData] =
    useState<PaginatedResponse<SkillEvalRecord> | null>(null);
  const [skillEvalsLoading, setSkillEvalsLoading] = useState(true);
  const [skillEvalsRefreshing, setSkillEvalsRefreshing] = useState(false);
  const [skillEvalsError, setSkillEvalsError] = useState<string | null>(null);
  const [skillEvalsPage, setSkillEvalsPage] = useState(1);
  const [expandedSkillEvalId, setExpandedSkillEvalId] = useState<string | null>(
    null,
  );
  const [recommendationOptions, setRecommendationOptions] = useState<string[]>(
    [],
  );
  const [skillEvalFilters, setSkillEvalFilters] = useState({
    recommendation: ALL_VALUE,
    didImprove: ALL_VALUE,
    skillId: "",
  });

  const [evalCasesData, setEvalCasesData] =
    useState<PaginatedResponse<EvalCase> | null>(null);
  const [evalCasesLoading, setEvalCasesLoading] = useState(true);
  const [evalCasesRefreshing, setEvalCasesRefreshing] = useState(false);
  const [evalCasesError, setEvalCasesError] = useState<string | null>(null);
  const [evalCasesPage, setEvalCasesPage] = useState(1);
  const [expandedEvalCaseId, setExpandedEvalCaseId] = useState<string | null>(
    null,
  );
  const [evalCaseTypeOptionsState, setEvalCaseTypeOptionsState] = useState<
    string[]
  >([...evalCaseTypeOptions]);
  const [evalCaseFilters, setEvalCaseFilters] = useState({
    caseType: ALL_VALUE,
    isActive: ALL_VALUE,
  });
  const [caseActionId, setCaseActionId] = useState<string | null>(null);
  const [addCaseOpen, setAddCaseOpen] = useState(false);
  const [addCaseForm, setAddCaseForm] =
    useState<AddCaseFormState>(emptyAddCaseForm);
  const [addCaseSaving, setAddCaseSaving] = useState(false);
  const [addCaseError, setAddCaseError] = useState<string | null>(null);

  const patternRequestIdRef = useRef(0);
  const candidateRequestIdRef = useRef(0);
  const skillEvalRequestIdRef = useRef(0);
  const evalCaseRequestIdRef = useRef(0);

  const pushToast = useCallback(
    (title: string, tone: ToastTone = "success") => {
      setToastState({ title, tone });
    },
    [],
  );

  const markRefreshed = useCallback(() => {
    setLastRefreshAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!toastState) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToastState(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toastState]);

  const fetchPatterns = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const requestId = ++patternRequestIdRef.current;
      if (background) {
        setPatternsRefreshing(true);
      } else {
        setPatternsLoading(true);
      }

      try {
        const params = new URLSearchParams({
          resource: "patterns",
          page: String(patternsPage),
          page_size: String(PAGE_SIZE),
        });
        if (patternFilters.status !== ALL_VALUE) {
          params.set("status", patternFilters.status);
        }
        if (patternFilters.patternType !== ALL_VALUE) {
          params.set("pattern_type", patternFilters.patternType);
        }

        const payload = await fetchJson<PaginatedResponse<ImprovementPattern>>(
          `/api/admin/improvement?${params.toString()}`,
          { signal },
          "Failed to load improvement patterns.",
        );
        if (signal?.aborted || requestId !== patternRequestIdRef.current) {
          return;
        }

        setPatternsData(payload);
        setPatternsError(null);
        setPatternStatusOptions((current) =>
          mergeOptions(
            current,
            payload.items.map((item) => item.status),
            ["acknowledged", "ignored", "resolved"],
          ),
        );
        setPatternTypeOptions((current) =>
          mergeOptions(
            current,
            payload.items.map((item) => item.pattern_type),
          ),
        );
        setExpandedPatternId((current) =>
          payload.items.some((item) => item.id === current) ? current : null,
        );
        markRefreshed();
      } catch (error) {
        if (signal?.aborted || requestId !== patternRequestIdRef.current) {
          return;
        }
        setPatternsError(
          error instanceof Error
            ? error.message
            : "Failed to load improvement patterns.",
        );
      } finally {
        if (!signal?.aborted && requestId === patternRequestIdRef.current) {
          setPatternsLoading(false);
          setPatternsRefreshing(false);
        }
      }
    },
    [
      markRefreshed,
      patternFilters.patternType,
      patternFilters.status,
      patternsPage,
    ],
  );

  const fetchCandidates = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const requestId = ++candidateRequestIdRef.current;
      if (background) {
        setCandidatesRefreshing(true);
      } else {
        setCandidatesLoading(true);
      }

      try {
        const params = new URLSearchParams({
          resource: "candidates",
          page: String(candidatesPage),
          page_size: String(PAGE_SIZE),
        });
        if (candidateFilters.decision !== ALL_VALUE) {
          params.set("decision", candidateFilters.decision);
        }
        if (candidateFilters.approvalStatus !== ALL_VALUE) {
          params.set("approval_status", candidateFilters.approvalStatus);
        }

        const payload = await fetchJson<PaginatedResponse<EvolutionCandidate>>(
          `/api/admin/improvement?${params.toString()}`,
          { signal },
          "Failed to load evolution candidates.",
        );
        if (signal?.aborted || requestId !== candidateRequestIdRef.current) {
          return;
        }

        setCandidatesData(payload);
        setCandidatesError(null);
        setCandidateApprovalOptions((current) =>
          mergeOptions(
            current,
            payload.items.map((item) => item.approval_status),
          ),
        );
        setExpandedCandidateId((current) =>
          payload.items.some((item) => item.id === current) ? current : null,
        );
        markRefreshed();
      } catch (error) {
        if (signal?.aborted || requestId !== candidateRequestIdRef.current) {
          return;
        }
        setCandidatesError(
          error instanceof Error
            ? error.message
            : "Failed to load evolution candidates.",
        );
      } finally {
        if (!signal?.aborted && requestId === candidateRequestIdRef.current) {
          setCandidatesLoading(false);
          setCandidatesRefreshing(false);
        }
      }
    },
    [
      candidateFilters.approvalStatus,
      candidateFilters.decision,
      candidatesPage,
      markRefreshed,
    ],
  );

  const fetchSkillEvals = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const requestId = ++skillEvalRequestIdRef.current;
      if (background) {
        setSkillEvalsRefreshing(true);
      } else {
        setSkillEvalsLoading(true);
      }

      try {
        const params = new URLSearchParams({
          resource: "skill-evals",
          page: String(skillEvalsPage),
          page_size: String(PAGE_SIZE),
        });
        if (skillEvalFilters.recommendation !== ALL_VALUE) {
          params.set("recommendation", skillEvalFilters.recommendation);
        }
        if (skillEvalFilters.didImprove !== ALL_VALUE) {
          params.set("did_improve", skillEvalFilters.didImprove);
        }
        if (skillEvalFilters.skillId.trim()) {
          params.set("skill_id", skillEvalFilters.skillId.trim());
        }

        const payload = await fetchJson<PaginatedResponse<SkillEvalRecord>>(
          `/api/admin/improvement?${params.toString()}`,
          { signal },
          "Failed to load skill evaluations.",
        );
        if (signal?.aborted || requestId !== skillEvalRequestIdRef.current) {
          return;
        }

        setSkillEvalsData(payload);
        setSkillEvalsError(null);
        setRecommendationOptions((current) =>
          mergeOptions(
            current,
            payload.items.map((item) => item.recommendation),
          ),
        );
        setExpandedSkillEvalId((current) =>
          payload.items.some((item) => item.id === current) ? current : null,
        );
        markRefreshed();
      } catch (error) {
        if (signal?.aborted || requestId !== skillEvalRequestIdRef.current) {
          return;
        }
        setSkillEvalsError(
          error instanceof Error
            ? error.message
            : "Failed to load skill evaluations.",
        );
      } finally {
        if (!signal?.aborted && requestId === skillEvalRequestIdRef.current) {
          setSkillEvalsLoading(false);
          setSkillEvalsRefreshing(false);
        }
      }
    },
    [
      markRefreshed,
      skillEvalFilters.didImprove,
      skillEvalFilters.recommendation,
      skillEvalFilters.skillId,
      skillEvalsPage,
    ],
  );

  const fetchEvalCases = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const requestId = ++evalCaseRequestIdRef.current;
      if (background) {
        setEvalCasesRefreshing(true);
      } else {
        setEvalCasesLoading(true);
      }

      try {
        const params = new URLSearchParams({
          resource: "eval-cases",
          page: String(evalCasesPage),
          page_size: String(PAGE_SIZE),
        });
        if (evalCaseFilters.caseType !== ALL_VALUE) {
          params.set("case_type", evalCaseFilters.caseType);
        }
        if (evalCaseFilters.isActive !== ALL_VALUE) {
          params.set("is_active", evalCaseFilters.isActive);
        }

        const payload = await fetchJson<PaginatedResponse<EvalCase>>(
          `/api/admin/improvement?${params.toString()}`,
          { signal },
          "Failed to load eval cases.",
        );
        if (signal?.aborted || requestId !== evalCaseRequestIdRef.current) {
          return;
        }

        setEvalCasesData(payload);
        setEvalCasesError(null);
        setEvalCaseTypeOptionsState((current) =>
          mergeOptions(
            current,
            payload.items.map((item) => item.case_type),
            [...evalCaseTypeOptions],
          ),
        );
        setExpandedEvalCaseId((current) =>
          payload.items.some((item) => item.id === current) ? current : null,
        );
        markRefreshed();
      } catch (error) {
        if (signal?.aborted || requestId !== evalCaseRequestIdRef.current) {
          return;
        }
        setEvalCasesError(
          error instanceof Error ? error.message : "Failed to load eval cases.",
        );
      } finally {
        if (!signal?.aborted && requestId === evalCaseRequestIdRef.current) {
          setEvalCasesLoading(false);
          setEvalCasesRefreshing(false);
        }
      }
    },
    [
      evalCaseFilters.caseType,
      evalCaseFilters.isActive,
      evalCasesPage,
      markRefreshed,
    ],
  );

  useEffect(() => {
    if (activeTab !== "patterns") {
      return undefined;
    }
    const controller = new AbortController();
    void fetchPatterns(controller.signal);
    return () => controller.abort();
  }, [activeTab, fetchPatterns]);

  useEffect(() => {
    if (activeTab !== "candidates") {
      return undefined;
    }
    const controller = new AbortController();
    void fetchCandidates(controller.signal);
    return () => controller.abort();
  }, [activeTab, fetchCandidates]);

  useEffect(() => {
    if (activeTab !== "skill-evals") {
      return undefined;
    }
    const controller = new AbortController();
    void fetchSkillEvals(controller.signal);
    return () => controller.abort();
  }, [activeTab, fetchSkillEvals]);

  useEffect(() => {
    if (activeTab !== "eval-cases") {
      return undefined;
    }
    const controller = new AbortController();
    void fetchEvalCases(controller.signal);
    return () => controller.abort();
  }, [activeTab, fetchEvalCases]);

  useEffect(() => {
    if (activeTab !== "skill-evals") {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void fetchSkillEvals(undefined, true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, fetchSkillEvals]);

  const refreshActiveTab = useCallback(async () => {
    switch (activeTab) {
      case "patterns":
        await fetchPatterns(undefined, true);
        break;
      case "candidates":
        await fetchCandidates(undefined, true);
        break;
      case "skill-evals":
        await fetchSkillEvals(undefined, true);
        break;
      case "eval-cases":
        await fetchEvalCases(undefined, true);
        break;
    }
  }, [
    activeTab,
    fetchCandidates,
    fetchEvalCases,
    fetchPatterns,
    fetchSkillEvals,
  ]);

  const runEvolutionCycle = useCallback(async () => {
    setRunningCycle(true);
    try {
      await fetchJson(
        "/api/admin/improvement?resource=run-cycle",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
        "Failed to trigger the evolution cycle.",
      );
      pushToast("Evolution cycle triggered.");
      markRefreshed();
      await refreshActiveTab();
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : "Failed to trigger the evolution cycle.",
        "error",
      );
    } finally {
      setRunningCycle(false);
    }
  }, [markRefreshed, pushToast, refreshActiveTab]);

  const updatePatternStatus = useCallback(
    async (patternId: string, status: PatternStatusAction) => {
      setPatternActionId(patternId);
      try {
        await fetchJson(
          `/api/admin/improvement/${encodeURIComponent(patternId)}?resource=patterns&action=status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
          "Failed to update pattern status.",
        );
        pushToast(`Pattern marked ${humanize(status).toLowerCase()}.`);
        await fetchPatterns(undefined, true);
      } catch (error) {
        pushToast(
          error instanceof Error
            ? error.message
            : "Failed to update pattern status.",
          "error",
        );
      } finally {
        setPatternActionId(null);
      }
    },
    [fetchPatterns, pushToast],
  );

  const openDecisionDialog = useCallback(
    (candidate: EvolutionCandidate, decision: CandidateDecision) => {
      setDecisionCandidate(candidate);
      setPendingDecision(decision);
      setDecisionReason("");
      setDecisionError(null);
      setDecisionDialogOpen(true);
    },
    [],
  );

  const submitCandidateDecision = useCallback(async () => {
    if (!decisionCandidate) {
      return;
    }

    setDecisionSaving(true);
    setDecisionError(null);
    try {
      await fetchJson(
        `/api/admin/improvement/${encodeURIComponent(decisionCandidate.id)}?resource=candidates&action=decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: pendingDecision,
            reason: decisionReason.trim() || undefined,
          }),
        },
        "Failed to save candidate decision.",
      );
      pushToast(`Candidate ${humanize(pendingDecision).toLowerCase()} saved.`);
      setDecisionDialogOpen(false);
      setDecisionCandidate(null);
      setDecisionReason("");
      await fetchCandidates(undefined, true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save candidate decision.";
      setDecisionError(message);
      pushToast(message, "error");
    } finally {
      setDecisionSaving(false);
    }
  }, [
    decisionCandidate,
    decisionReason,
    fetchCandidates,
    pendingDecision,
    pushToast,
  ]);

  const submitEvalCase = useCallback(async () => {
    const description = addCaseForm.description.trim();
    const expectedBehavior = addCaseForm.expectedBehavior.trim();
    if (!description || !expectedBehavior) {
      setAddCaseError("Description and expected behavior are required.");
      return;
    }

    let inputContext: Record<string, unknown>;
    try {
      const parsed = JSON.parse(addCaseForm.inputContext || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Input context must be a JSON object.");
      }
      inputContext = parsed as Record<string, unknown>;
    } catch (error) {
      setAddCaseError(
        error instanceof Error
          ? error.message
          : "Input context must be valid JSON.",
      );
      return;
    }

    setAddCaseSaving(true);
    setAddCaseError(null);
    try {
      await fetchJson(
        "/api/admin/improvement?resource=eval-cases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skill_id: addCaseForm.skillId.trim() || null,
            case_type: addCaseForm.caseType,
            description,
            input_context: inputContext,
            expected_behavior: expectedBehavior,
            acceptance_criteria:
              addCaseForm.acceptanceCriteria.trim() || undefined,
            tags: addCaseForm.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          }),
        },
        "Failed to create eval case.",
      );
      pushToast("Eval case added.");
      setAddCaseOpen(false);
      setAddCaseForm(emptyAddCaseForm);
      await fetchEvalCases(undefined, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create eval case.";
      setAddCaseError(message);
      pushToast(message, "error");
    } finally {
      setAddCaseSaving(false);
    }
  }, [addCaseForm, fetchEvalCases, pushToast]);

  const deactivateEvalCase = useCallback(
    async (evalCaseId: string) => {
      setCaseActionId(evalCaseId);
      try {
        await fetchJson(
          `/api/admin/improvement/${encodeURIComponent(evalCaseId)}?resource=eval-cases`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: false }),
          },
          "Failed to deactivate eval case.",
        );
        pushToast("Eval case deactivated.");
        await fetchEvalCases(undefined, true);
      } catch (error) {
        pushToast(
          error instanceof Error
            ? error.message
            : "Failed to deactivate eval case.",
          "error",
        );
      } finally {
        setCaseActionId(null);
      }
    },
    [fetchEvalCases, pushToast],
  );

  const patternStats = useMemo(() => {
    const items = patternsData?.items ?? [];
    return {
      total: patternsData?.total ?? 0,
      systemic: items.filter((item) => item.is_systemic).length,
      unreviewed: items.filter(
        (item) => !reviewedPatternStatuses.has(item.status.toLowerCase()),
      ).length,
    };
  }, [patternsData]);

  const candidateStats = useMemo(() => {
    const items = candidatesData?.items ?? [];
    return {
      total: candidatesData?.total ?? 0,
      promoted: items.filter((item) => item.decision === "promote").length,
      rejected: items.filter((item) => item.decision === "reject").length,
      quarantined: items.filter((item) => item.decision === "quarantine")
        .length,
      pending: items.filter((item) => !item.decision).length,
    };
  }, [candidatesData]);

  const skillEvalStats = useMemo(() => {
    const items = skillEvalsData?.items ?? [];
    const comparable = items.filter((item) => item.did_improve != null);
    const evidenceValues = items
      .map((item) => item.evidence_strength)
      .filter((value): value is number => value != null);
    const improvedCount = comparable.filter((item) => item.did_improve).length;
    return {
      total: skillEvalsData?.total ?? 0,
      improvedRate: comparable.length
        ? (improvedCount / comparable.length) * 100
        : 0,
      averageEvidence: evidenceValues.length
        ? evidenceValues.reduce((sum, value) => sum + value, 0) /
          evidenceValues.length
        : 0,
    };
  }, [skillEvalsData]);

  const evalCaseStats = useMemo(() => {
    const items = evalCasesData?.items ?? [];
    return {
      total: evalCasesData?.total ?? 0,
      active: items.filter((item) => item.is_active).length,
    };
  }, [evalCasesData]);

  const patternsPageCount = patternsData
    ? Math.max(1, Math.ceil(patternsData.total / patternsData.page_size))
    : 1;
  const candidatesPageCount = candidatesData
    ? Math.max(1, Math.ceil(candidatesData.total / candidatesData.page_size))
    : 1;
  const skillEvalsPageCount = skillEvalsData
    ? Math.max(1, Math.ceil(skillEvalsData.total / skillEvalsData.page_size))
    : 1;
  const evalCasesPageCount = evalCasesData
    ? Math.max(1, Math.ceil(evalCasesData.total / evalCasesData.page_size))
    : 1;

  const activeTabBusy =
    (activeTab === "patterns" && (patternsLoading || patternsRefreshing)) ||
    (activeTab === "candidates" &&
      (candidatesLoading || candidatesRefreshing)) ||
    (activeTab === "skill-evals" &&
      (skillEvalsLoading || skillEvalsRefreshing)) ||
    (activeTab === "eval-cases" && (evalCasesLoading || evalCasesRefreshing));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <FlaskConical className="size-7" />
            Skill Improvement Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Review detected issues, evaluate skill mutations, curate eval
            coverage, and monitor recommendation quality.
          </p>
          <p className="text-xs text-muted-foreground">
            Last refresh:{" "}
            {lastRefreshAt
              ? formatDateTime(lastRefreshAt)
              : "Waiting for first load"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refreshActiveTab()}
            disabled={activeTabBusy || runningCycle}
          >
            <RefreshCw
              className={cn("mr-2 size-4", activeTabBusy ? "animate-spin" : "")}
            />
            Refresh Current Tab
          </Button>
          <Button
            onClick={() => void runEvolutionCycle()}
            disabled={runningCycle}
          >
            <Activity
              className={cn("mr-2 size-4", runningCycle ? "animate-spin" : "")}
            />
            Run Evolution Cycle
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabKey)}
        className="space-y-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 lg:grid-cols-4">
          <TabsTrigger value="patterns" className="w-full">
            Patterns
          </TabsTrigger>
          <TabsTrigger value="candidates" className="w-full">
            Candidates
          </TabsTrigger>
          <TabsTrigger value="skill-evals" className="w-full">
            Skill Evaluations
          </TabsTrigger>
          <TabsTrigger value="eval-cases" className="w-full">
            Eval Cases
          </TabsTrigger>
        </TabsList>

        <TabsContent value="patterns" className="space-y-4">
          {patternsLoading && !patternsData ? (
            <SummarySkeletons count={3} />
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SummaryCard
                label="Total Patterns"
                value={numberFormatter.format(patternStats.total)}
                description="Matching the current filters"
                icon={ScrollText}
              />
              <SummaryCard
                label="Systemic Patterns"
                value={numberFormatter.format(patternStats.systemic)}
                description="Visible on this page"
                icon={AlertCircle}
              />
              <SummaryCard
                label="New / Unreviewed"
                value={numberFormatter.format(patternStats.unreviewed)}
                description="Awaiting a status change"
                icon={Wrench}
              />
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Focus on a specific status or pattern type.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Status</p>
                  <Select
                    value={patternFilters.status}
                    onValueChange={(value) => {
                      setPatternsPage(1);
                      setPatternFilters((current) => ({
                        ...current,
                        status: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {patternStatusOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Pattern type</p>
                  <Select
                    value={patternFilters.patternType}
                    onValueChange={(value) => {
                      setPatternsPage(1);
                      setPatternFilters((current) => ({
                        ...current,
                        patternType: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All pattern types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {patternTypeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Improvement patterns</CardTitle>
              <CardDescription>
                Review detected failure patterns and mark how each issue has
                been handled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {patternsError ? <InlineAlert message={patternsError} /> : null}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[1100px]">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Pattern Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Skill</TableHead>
                      <TableHead className="text-right">Frequency</TableHead>
                      <TableHead className="text-right">Severity</TableHead>
                      <TableHead className="text-center">Systemic?</TableHead>
                      <TableHead>Detected At</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patternsLoading && !patternsData
                      ? rangeKeys("pattern-skeleton", 6).map((key) => (
                          <TableRow key={key}>
                            <TableCell>
                              <Skeleton className="h-5 w-28" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-72" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-20" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-4 w-10" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-4 w-10" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="mx-auto h-6 w-12" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-28" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-24" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-7 w-36" />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                    {!patternsLoading &&
                    (patternsData?.items.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No improvement patterns matched the current filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(patternsData?.items ?? []).map((pattern) => {
                      const isOpen = expandedPatternId === pattern.id;
                      return (
                        <Fragment key={pattern.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedPatternId((current) =>
                                current === pattern.id ? null : pattern.id,
                              )
                            }
                          >
                            <TableCell className="font-medium">
                              {humanize(pattern.pattern_type)}
                            </TableCell>
                            <TableCell className="max-w-[22rem]">
                              <span title={pattern.description}>
                                {truncateText(pattern.description, 80)}
                              </span>
                            </TableCell>
                            <TableCell>
                              {pattern.skill_id
                                ? shortId(pattern.skill_id)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {numberFormatter.format(pattern.frequency)}
                            </TableCell>
                            <TableCell className="text-right">
                              {pattern.severity ?? "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-medium",
                                  pattern.is_systemic
                                    ? badgeClass("new")
                                    : badgeClass(undefined),
                                )}
                              >
                                {pattern.is_systemic ? "Yes" : "No"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {formatDateTime(pattern.detected_at)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge value={pattern.status} />
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void updatePatternStatus(
                                      pattern.id,
                                      "acknowledged",
                                    );
                                  }}
                                  disabled={patternActionId === pattern.id}
                                >
                                  Acknowledge
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void updatePatternStatus(
                                      pattern.id,
                                      "resolved",
                                    );
                                  }}
                                  disabled={patternActionId === pattern.id}
                                >
                                  Resolve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void updatePatternStatus(
                                      pattern.id,
                                      "ignored",
                                    );
                                  }}
                                  disabled={patternActionId === pattern.id}
                                >
                                  Ignore
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={9}>
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2 lg:col-span-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Full Description
                                    </p>
                                    <p className="text-sm leading-6">
                                      {pattern.description}
                                    </p>
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Evidence
                                    </p>
                                    <JsonBlock value={pattern.evidence} />
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Example Run IDs
                                    </p>
                                    <JsonBlock
                                      value={pattern.example_run_ids}
                                    />
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={patternsData?.page ?? patternsPage}
                pageCount={patternsPageCount}
                total={patternsData?.total ?? 0}
                loading={patternsLoading || Boolean(patternActionId)}
                onPrevious={() =>
                  setPatternsPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setPatternsPage((current) =>
                    Math.min(patternsPageCount, current + 1),
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="candidates" className="space-y-4">
          {candidatesLoading && !candidatesData ? (
            <SummarySkeletons count={5} />
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <SummaryCard
                label="Total Candidates"
                value={numberFormatter.format(candidateStats.total)}
                description="Matching the current filters"
                icon={Wrench}
              />
              <SummaryCard
                label="Promoted"
                value={numberFormatter.format(candidateStats.promoted)}
                description="On this page"
                icon={CheckCircle2}
              />
              <SummaryCard
                label="Rejected"
                value={numberFormatter.format(candidateStats.rejected)}
                description="On this page"
                icon={XCircle}
              />
              <SummaryCard
                label="Quarantined"
                value={numberFormatter.format(candidateStats.quarantined)}
                description="On this page"
                icon={AlertCircle}
              />
              <SummaryCard
                label="Pending"
                value={numberFormatter.format(candidateStats.pending)}
                description="No decision yet"
                icon={ScrollText}
              />
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Review candidate decisions and approval state.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Decision</p>
                  <Select
                    value={candidateFilters.decision}
                    onValueChange={(value) => {
                      setCandidatesPage(1);
                      setCandidateFilters((current) => ({
                        ...current,
                        decision: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All decisions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {candidateDecisionOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Approval status</p>
                  <Select
                    value={candidateFilters.approvalStatus}
                    onValueChange={(value) => {
                      setCandidatesPage(1);
                      setCandidateFilters((current) => ({
                        ...current,
                        approvalStatus: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All approval states" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {candidateApprovalOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evolution candidates</CardTitle>
              <CardDescription>
                Compare current and proposed skill content, inspect test output,
                and decide what moves forward.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {candidatesError ? (
                <InlineAlert message={candidatesError} />
              ) : null}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[1100px]">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Type</TableHead>
                      <TableHead>Skill</TableHead>
                      <TableHead>Rationale</TableHead>
                      <TableHead className="text-right">Eval Score</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidatesLoading && !candidatesData
                      ? rangeKeys("candidate-skeleton", 6).map((key) => (
                          <TableRow key={key}>
                            <TableCell>
                              <Skeleton className="h-4 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-20" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-64" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-4 w-12" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-28" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-7 w-48" />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                    {!candidatesLoading &&
                    (candidatesData?.items.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No evolution candidates matched the current filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(candidatesData?.items ?? []).map((candidate) => {
                      const isOpen = expandedCandidateId === candidate.id;
                      return (
                        <Fragment key={candidate.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedCandidateId((current) =>
                                current === candidate.id ? null : candidate.id,
                              )
                            }
                          >
                            <TableCell className="font-medium">
                              {humanize(candidate.candidate_type)}
                            </TableCell>
                            <TableCell>
                              {candidate.skill_id
                                ? shortId(candidate.skill_id)
                                : "—"}
                            </TableCell>
                            <TableCell className="max-w-[22rem]">
                              <span title={candidate.rationale ?? undefined}>
                                {truncateText(
                                  candidate.rationale ??
                                    "No rationale provided.",
                                  80,
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatMetric(candidate.eval_score)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                value={candidate.decision ?? "pending"}
                              />
                            </TableCell>
                            <TableCell>
                              <StatusBadge value={candidate.approval_status} />
                            </TableCell>
                            <TableCell>
                              {formatDateTime(candidate.created_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDecisionDialog(candidate, "promote");
                                  }}
                                >
                                  Promote
                                </Button>
                                <Button
                                  size="sm"
                                  className="bg-amber-500 text-black hover:bg-amber-400 dark:bg-amber-500 dark:text-black"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDecisionDialog(candidate, "quarantine");
                                  }}
                                >
                                  Quarantine
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDecisionDialog(candidate, "reject");
                                  }}
                                >
                                  Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={8}>
                                <div className="space-y-4">
                                  <div className="grid gap-4 xl:grid-cols-2">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Current Content
                                      </p>
                                      <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                                        {candidate.current_content || "None"}
                                      </pre>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Proposed Content
                                      </p>
                                      <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                                        {candidate.proposed_content || "None"}
                                      </pre>
                                    </div>
                                  </div>
                                  <div className="grid gap-4 xl:grid-cols-2">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Comparison Scores
                                      </p>
                                      <ComparisonScores
                                        scores={candidate.comparison_scores}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Test Results
                                      </p>
                                      <JsonBlock
                                        value={candidate.test_results}
                                      />
                                    </div>
                                  </div>
                                  <div className="grid gap-4 xl:grid-cols-2">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Decision Reason
                                      </p>
                                      <p className="text-sm leading-6 text-muted-foreground">
                                        {candidate.decision_reason ||
                                          "No decision reason provided."}
                                      </p>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Linked Pattern
                                      </p>
                                      <p className="text-sm leading-6 text-muted-foreground">
                                        {candidate.detected_pattern ||
                                          candidate.pattern_id ||
                                          "—"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={candidatesData?.page ?? candidatesPage}
                pageCount={candidatesPageCount}
                total={candidatesData?.total ?? 0}
                loading={candidatesLoading || decisionSaving}
                onPrevious={() =>
                  setCandidatesPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setCandidatesPage((current) =>
                    Math.min(candidatesPageCount, current + 1),
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skill-evals" className="space-y-4">
          {skillEvalsLoading && !skillEvalsData ? (
            <SummarySkeletons count={3} />
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SummaryCard
                label="Total Evals"
                value={numberFormatter.format(skillEvalStats.total)}
                description="Matching the current filters"
                icon={Activity}
              />
              <SummaryCard
                label="Improved %"
                value={formatPercent(skillEvalStats.improvedRate)}
                description="From visible rows with a verdict"
                icon={CheckCircle2}
              />
              <SummaryCard
                label="Average Evidence Strength"
                value={formatMetric(skillEvalStats.averageEvidence)}
                description="Visible on this page"
                icon={Wrench}
              />
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Auto-refreshes every 30 seconds while this tab is open.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Recommendation</p>
                  <Select
                    value={skillEvalFilters.recommendation}
                    onValueChange={(value) => {
                      setSkillEvalsPage(1);
                      setSkillEvalFilters((current) => ({
                        ...current,
                        recommendation: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All recommendations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {recommendationOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Did improve?</p>
                  <Select
                    value={skillEvalFilters.didImprove}
                    onValueChange={(value) => {
                      setSkillEvalsPage(1);
                      setSkillEvalFilters((current) => ({
                        ...current,
                        didImprove: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All outcomes" />
                    </SelectTrigger>
                    <SelectContent>
                      {booleanOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 xl:col-span-2">
                  <p className="text-sm font-medium">Skill ID</p>
                  <Input
                    value={skillEvalFilters.skillId}
                    onChange={(event) => {
                      setSkillEvalsPage(1);
                      setSkillEvalFilters((current) => ({
                        ...current,
                        skillId: event.target.value,
                      }));
                    }}
                    placeholder="skill_123"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Skill evaluations</CardTitle>
              <CardDescription>
                Inspect whether a candidate helped, what improved, and where
                regressions were observed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {skillEvalsError ? (
                <InlineAlert message={skillEvalsError} />
              ) : null}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[1100px]">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Skill ID</TableHead>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Did Improve?</TableHead>
                      <TableHead>Evidence</TableHead>
                      <TableHead>Recommendation</TableHead>
                      <TableHead>Dimensions</TableHead>
                      <TableHead>Created At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skillEvalsLoading && !skillEvalsData
                      ? rangeKeys("skill-eval-skeleton", 6).map((key) => (
                          <TableRow key={key}>
                            <TableCell>
                              <Skeleton className="h-4 w-20" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-20" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-16" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-10" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-48" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-28" />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                    {!skillEvalsLoading &&
                    (skillEvalsData?.items.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No skill evaluations matched the current filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(skillEvalsData?.items ?? []).map((record) => {
                      const isOpen = expandedSkillEvalId === record.id;
                      return (
                        <Fragment key={record.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedSkillEvalId((current) =>
                                current === record.id ? null : record.id,
                              )
                            }
                          >
                            <TableCell className="font-medium">
                              {shortId(record.skill_id)}
                            </TableCell>
                            <TableCell>{shortId(record.run_id)}</TableCell>
                            <TableCell>
                              <StatusBadge
                                value={
                                  record.did_improve == null
                                    ? "pending"
                                    : record.did_improve
                                      ? "improved"
                                      : "failed"
                                }
                              />
                            </TableCell>
                            <TableCell>
                              {record.evidence_strength ?? "—"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge value={record.recommendation} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {record.dimensions_improved.length > 0 ? (
                                  record.dimensions_improved.map(
                                    (dimension) => (
                                      <Badge
                                        key={dimension}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {humanize(dimension)}
                                      </Badge>
                                    ),
                                  )
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {formatDateTime(record.created_at)}
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={7}>
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2 lg:col-span-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Task Context
                                    </p>
                                    <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                                      {record.task_context || "None"}
                                    </pre>
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Improvement Detail
                                    </p>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                      {record.improvement_detail || "None"}
                                    </p>
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Negative Effects
                                    </p>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                      {record.negative_effects || "None"}
                                    </p>
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Eval Notes
                                    </p>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                      {record.eval_notes || "None"}
                                    </p>
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Counterfactual Worse?
                                    </p>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                      {record.counterfactual_worse == null
                                        ? "Unknown"
                                        : record.counterfactual_worse
                                          ? "Yes"
                                          : "No"}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={skillEvalsData?.page ?? skillEvalsPage}
                pageCount={skillEvalsPageCount}
                total={skillEvalsData?.total ?? 0}
                loading={skillEvalsLoading || skillEvalsRefreshing}
                onPrevious={() =>
                  setSkillEvalsPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setSkillEvalsPage((current) =>
                    Math.min(skillEvalsPageCount, current + 1),
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="eval-cases" className="space-y-4">
          {evalCasesLoading && !evalCasesData ? (
            <SummarySkeletons count={2} />
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
              <SummaryCard
                label="Total Cases"
                value={numberFormatter.format(evalCaseStats.total)}
                description="Matching the current filters"
                icon={ScrollText}
              />
              <SummaryCard
                label="Active"
                value={numberFormatter.format(evalCaseStats.active)}
                description="Visible on this page"
                icon={CheckCircle2}
              />
            </section>
          )}

          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Filters</CardTitle>
                <CardDescription>
                  Manage coverage by case type and active status.
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  setAddCaseError(null);
                  setAddCaseOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                Add Case
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Case type</p>
                  <Select
                    value={evalCaseFilters.caseType}
                    onValueChange={(value) => {
                      setEvalCasesPage(1);
                      setEvalCaseFilters((current) => ({
                        ...current,
                        caseType: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All case types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All</SelectItem>
                      {evalCaseTypeOptionsState.map((option) => (
                        <SelectItem key={option} value={option}>
                          {humanize(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Active</p>
                  <Select
                    value={evalCaseFilters.isActive}
                    onValueChange={(value) => {
                      setEvalCasesPage(1);
                      setEvalCaseFilters((current) => ({
                        ...current,
                        isActive: value,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All states" />
                    </SelectTrigger>
                    <SelectContent>
                      {booleanOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evaluation cases</CardTitle>
              <CardDescription>
                Add new regression checks and deactivate cases that should no
                longer run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {evalCasesError ? <InlineAlert message={evalCasesError} /> : null}
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[1100px]">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Description</TableHead>
                      <TableHead>Case Type</TableHead>
                      <TableHead>Skill</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evalCasesLoading && !evalCasesData
                      ? rangeKeys("eval-case-skeleton", 6).map((key) => (
                          <TableRow key={key}>
                            <TableCell>
                              <Skeleton className="h-4 w-72" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-20" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-6 w-16" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-32" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-28" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Skeleton className="ml-auto h-7 w-16" />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                    {!evalCasesLoading &&
                    (evalCasesData?.items.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No eval cases matched the current filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(evalCasesData?.items ?? []).map((evalCase) => {
                      const isOpen = expandedEvalCaseId === evalCase.id;
                      return (
                        <Fragment key={evalCase.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedEvalCaseId((current) =>
                                current === evalCase.id ? null : evalCase.id,
                              )
                            }
                          >
                            <TableCell className="max-w-[24rem] font-medium">
                              {truncateText(evalCase.description, 90)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge value={evalCase.case_type} />
                            </TableCell>
                            <TableCell>
                              {evalCase.skill_id
                                ? shortId(evalCase.skill_id)
                                : "—"}
                            </TableCell>
                            <TableCell>{humanize(evalCase.source)}</TableCell>
                            <TableCell>
                              <StatusBadge
                                value={
                                  evalCase.is_active ? "active" : "inactive"
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {evalCase.tags.length > 0 ? (
                                  evalCase.tags.map((tag) => (
                                    <Badge
                                      key={tag}
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {tag}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {formatDateTime(evalCase.created_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deactivateEvalCase(evalCase.id);
                                  }}
                                  disabled={
                                    !evalCase.is_active ||
                                    caseActionId === evalCase.id
                                  }
                                >
                                  <Trash2 className="mr-1 size-3.5" />
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={8}>
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Input Context
                                    </p>
                                    <JsonBlock value={evalCase.input_context} />
                                  </div>
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Expected Behavior
                                    </p>
                                    <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                                      {evalCase.expected_behavior}
                                    </pre>
                                  </div>
                                  <div className="space-y-2 lg:col-span-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Acceptance Criteria
                                    </p>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                      {evalCase.acceptance_criteria || "None"}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={evalCasesData?.page ?? evalCasesPage}
                pageCount={evalCasesPageCount}
                total={evalCasesData?.total ?? 0}
                loading={evalCasesLoading || Boolean(caseActionId)}
                onPrevious={() =>
                  setEvalCasesPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setEvalCasesPage((current) =>
                    Math.min(evalCasesPageCount, current + 1),
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={decisionDialogOpen} onOpenChange={setDecisionDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{humanize(pendingDecision)} candidate</DialogTitle>
            <DialogDescription>
              Add an optional reason before saving the decision for this
              candidate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {decisionError ? <InlineAlert message={decisionError} /> : null}
            <div className="space-y-2">
              <Label>Candidate</Label>
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {decisionCandidate
                  ? humanize(decisionCandidate.candidate_type)
                  : "No candidate selected."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="candidate-decision-reason">
                Reason (optional)
              </Label>
              <Textarea
                id="candidate-decision-reason"
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Why are you making this decision?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDecisionDialogOpen(false)}
              disabled={decisionSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitCandidateDecision()}
              disabled={decisionSaving || !decisionCandidate}
            >
              <CheckCircle2 className="mr-2 size-4" />
              Confirm {humanize(pendingDecision)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addCaseOpen}
        onOpenChange={(open) => {
          setAddCaseOpen(open);
          if (!open) {
            setAddCaseError(null);
            setAddCaseForm(emptyAddCaseForm);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Eval Case</DialogTitle>
            <DialogDescription>
              Capture a new case for the improvement pipeline. Input context
              accepts JSON.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {addCaseError ? <InlineAlert message={addCaseError} /> : null}
            <div className="space-y-2">
              <Label htmlFor="eval-case-description">Description</Label>
              <Input
                id="eval-case-description"
                value={addCaseForm.description}
                onChange={(event) =>
                  setAddCaseForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Short summary of the case"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eval-case-type">Case Type</Label>
                <Select
                  value={addCaseForm.caseType}
                  onValueChange={(value) =>
                    setAddCaseForm((current) => ({
                      ...current,
                      caseType: value as CaseType,
                    }))
                  }
                >
                  <SelectTrigger id="eval-case-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {evalCaseTypeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {humanize(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="eval-case-skill">Skill ID (optional)</Label>
                <Input
                  id="eval-case-skill"
                  value={addCaseForm.skillId}
                  onChange={(event) =>
                    setAddCaseForm((current) => ({
                      ...current,
                      skillId: event.target.value,
                    }))
                  }
                  placeholder="skill_123"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="eval-case-input-context">
                Input Context (JSON)
              </Label>
              <Textarea
                id="eval-case-input-context"
                className="min-h-28 font-mono text-xs"
                value={addCaseForm.inputContext}
                onChange={(event) =>
                  setAddCaseForm((current) => ({
                    ...current,
                    inputContext: event.target.value,
                  }))
                }
                placeholder='{"messages": [], "intent": "failure"}'
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eval-case-expected-behavior">
                Expected Behavior
              </Label>
              <Textarea
                id="eval-case-expected-behavior"
                value={addCaseForm.expectedBehavior}
                onChange={(event) =>
                  setAddCaseForm((current) => ({
                    ...current,
                    expectedBehavior: event.target.value,
                  }))
                }
                placeholder="Describe the desired response or model behavior"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eval-case-acceptance-criteria">
                Acceptance Criteria (optional)
              </Label>
              <Textarea
                id="eval-case-acceptance-criteria"
                value={addCaseForm.acceptanceCriteria}
                onChange={(event) =>
                  setAddCaseForm((current) => ({
                    ...current,
                    acceptanceCriteria: event.target.value,
                  }))
                }
                placeholder="Pass/fail rubric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eval-case-tags">Tags</Label>
              <Input
                id="eval-case-tags"
                value={addCaseForm.tags}
                onChange={(event) =>
                  setAddCaseForm((current) => ({
                    ...current,
                    tags: event.target.value,
                  }))
                }
                placeholder="regression, tone, tool-use"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddCaseOpen(false)}
              disabled={addCaseSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitEvalCase()}
              disabled={addCaseSaving}
            >
              <Plus className="mr-2 size-4" />
              Add Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toastState ? (
        <div className="fixed right-4 bottom-4 z-50">
          <div
            className={cn(
              "rounded-lg border bg-background px-4 py-3 text-sm shadow-lg",
              toastState.tone === "error"
                ? "border-destructive/30 text-destructive"
                : "border-green-500/20 text-foreground",
            )}
          >
            {toastState.title}
          </div>
        </div>
      ) : null}
    </div>
  );
}
