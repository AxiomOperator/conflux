"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type OnboardingStatus = {
  completed: boolean;
  steps: {
    has_provider: boolean;
    has_agent: boolean;
    has_run: boolean;
  };
};

const STEP_COUNT = 5;

function StepCallout({
  actionHref,
  actionLabel,
  body,
  complete,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  body: string;
  complete?: boolean;
  title: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4 text-left",
        complete
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-border bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
            complete
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-primary/10 text-primary",
          )}
        >
          {complete ? <CheckCircle2 className="size-5" /> : <Sparkles className="size-4" />}
        </div>
        <div className="space-y-3">
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
          {actionHref && actionLabel ? (
            <Button asChild>
              <Link href={actionHref}>{actionLabel}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OnboardingWizard() {
  const pathname = usePathname();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/onboarding/status", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | OnboardingStatus
        | { detail?: string }
        | null;

      if (!response.ok || !data || !("steps" in data) || !("completed" in data)) {
        throw new Error(
          (data && "detail" in data && data.detail) ||
            `Failed to load onboarding status (${response.status})`,
        );
      }

      setStatus(data);
      if (data.completed) {
        setDismissed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load onboarding.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, pathname]);

  useEffect(() => {
    if (!status) {
      return;
    }

    let timeoutId: number | undefined;

    if (currentStep === 1 && status.steps.has_provider) {
      timeoutId = window.setTimeout(() => setCurrentStep(2), 900);
    }

    if (currentStep === 2 && status.steps.has_agent) {
      timeoutId = window.setTimeout(() => setCurrentStep(3), 900);
    }

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [currentStep, status]);

  const progress = ((currentStep + 1) / STEP_COUNT) * 100;
  const autoAdvanceMessage =
    currentStep === 1 && status?.steps.has_provider
      ? "Provider detected — moving to the next step…"
      : currentStep === 2 && status?.steps.has_agent
        ? "Agent detected — moving to the next step…"
        : null;

  async function completeTour() {
    try {
      setCompleting(true);
      setError(null);
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as
        | { success?: boolean; detail?: string }
        | null;

      if (!response.ok || !data?.success) {
        throw new Error(data?.detail || `Failed to complete onboarding (${response.status})`);
      }

      setDismissed(true);
      setStatus((prev) => (prev ? { ...prev, completed: true } : prev));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding.");
    } finally {
      setCompleting(false);
    }
  }

  if (!status || status.completed || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-4 py-8 backdrop-blur-sm">
      <Card className="relative w-full max-w-lg shadow-2xl">
        <Button
          variant="link"
          size="sm"
          className="absolute top-4 right-4 h-auto p-0 text-muted-foreground"
          onClick={() => void completeTour()}
          disabled={completing}
        >
          Skip tour
        </Button>

        <CardHeader className="space-y-5 pb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <span>Step {currentStep + 1} of {STEP_COUNT}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div
            key={currentStep}
            className="space-y-6 data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-right-2 data-[state=open]:animate-in"
            data-state="open"
          >
            {currentStep === 0 ? (
              <div className="space-y-6 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-8" />
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-3xl">Welcome to Conflux 🎉</CardTitle>
                  <CardDescription className="text-base">
                    Your AI Agent Harness is ready.
                  </CardDescription>
                </div>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll walk you through the essentials so you can launch your first agent run with confidence.
                </p>
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div className="space-y-6 text-center sm:text-left">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-primary">Connect a Provider</p>
                  <CardTitle className="text-2xl">Agents need an LLM provider to think.</CardTitle>
                  <CardDescription>
                    Connect at least one provider so your agents can call models and complete work.
                  </CardDescription>
                </div>
                <StepCallout
                  complete={status.steps.has_provider}
                  title={status.steps.has_provider ? "You're all set!" : "Add a provider to get started"}
                  body={
                    status.steps.has_provider
                      ? "Conflux already found an enabled provider for this workspace."
                      : "Open Providers to add your first LLM endpoint, key, and default model."
                  }
                  actionHref={status.steps.has_provider ? undefined : "/providers"}
                  actionLabel={status.steps.has_provider ? undefined : "Open Providers"}
                />
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="space-y-6 text-center sm:text-left">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-primary">Create an Agent</p>
                  <CardTitle className="text-2xl">Agents are your AI workers.</CardTitle>
                  <CardDescription>
                    Create a focused agent for research, support, automation, or any workflow you want to delegate.
                  </CardDescription>
                </div>
                <StepCallout
                  complete={status.steps.has_agent}
                  title={status.steps.has_agent ? "First agent ready" : "Create your first agent"}
                  body={
                    status.steps.has_agent
                      ? "Conflux found at least one agent in your account, so you can move straight into chat."
                      : "Open Agents to create your first worker and tailor its prompt, tools, and model policy."
                  }
                  actionHref={status.steps.has_agent ? undefined : "/agents"}
                  actionLabel={status.steps.has_agent ? undefined : "Open Agents"}
                />
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="space-y-6 text-center sm:text-left">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-primary">Start a Conversation</p>
                  <CardTitle className="text-2xl">Talk to your agent.</CardTitle>
                  <CardDescription>
                    Open chat, pick an agent, and kick off a real run to see Conflux in action.
                  </CardDescription>
                </div>
                <StepCallout
                  complete={status.steps.has_run}
                  title={status.steps.has_run ? "You've already started!" : "Open Chat"}
                  body={
                    status.steps.has_run
                      ? "A run already exists for your account, so you're ready to keep going from the dashboard."
                      : "Head to Chat to send your first message and watch an agent think out loud."
                  }
                  actionHref={status.steps.has_run ? undefined : "/chat"}
                  actionLabel={status.steps.has_run ? undefined : "Open Chat"}
                />
              </div>
            ) : null}

            {currentStep === 4 ? (
              <div className="space-y-6 text-center">
                <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 animate-pulse dark:text-emerald-400">
                  <CheckCircle2 className="size-10" />
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-3xl">You&apos;re ready to go 🚀</CardTitle>
                  <CardDescription className="text-base">
                    You have everything you need to explore providers, create agents, and start new runs.
                  </CardDescription>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-5 items-center text-xs text-muted-foreground">
            {error ? <span className="text-destructive">{error}</span> : autoAdvanceMessage}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {currentStep > 0 ? (
                <Button variant="outline" onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              {currentStep < STEP_COUNT - 1 ? (
                <>
                  <Button variant="ghost" onClick={() => setCurrentStep((step) => Math.min(step + 1, STEP_COUNT - 1))}>
                    Skip
                  </Button>
                  <Button onClick={() => setCurrentStep((step) => Math.min(step + 1, STEP_COUNT - 1))}>
                    Next
                    <ArrowRight className="size-4" />
                  </Button>
                </>
              ) : (
                <Button onClick={() => void completeTour()} disabled={completing}>
                  {completing ? <Loader2 className="size-4 animate-spin" /> : null}
                  Go to Dashboard
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
