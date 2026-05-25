"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type PersonalityPreset = {
  name: string;
  label: string;
  description: string;
  example: string;
};

export type PersonalityState = {
  preset: string | null;
  presets: PersonalityPreset[];
};

const PERSONALITY_EMOJI: Record<string, string> = {
  concise: "⚡",
  creative: "🎨",
  technical: "🛠️",
  friendly: "😊",
  formal: "🧾",
  balanced: "✨",
};

export function PersonalityPicker({
  currentPreset,
  onApplied,
  onOpenChange,
  open,
  presets,
}: {
  currentPreset: string | null;
  onApplied: (state: PersonalityState) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  presets: PersonalityPreset[];
}) {
  const [selectedPreset, setSelectedPreset] = useState<string>(currentPreset ?? "balanced");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedPreset(currentPreset ?? "balanced");
      setError(null);
    }
  }, [currentPreset, open]);

  const selectedMeta = useMemo(
    () => presets.find((preset) => preset.name === selectedPreset) ?? null,
    [presets, selectedPreset],
  );

  const applyPreset = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: selectedPreset === "balanced" ? null : selectedPreset,
        }),
      });
      const data = (await res.json().catch(() => null)) as PersonalityState | { detail?: string } | null;
      if (!res.ok || !data || !("presets" in data)) {
        throw new Error(
          (data && "detail" in data && data.detail) || `Failed to update personality (${res.status})`,
        );
      }
      onApplied(data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Choose agent personality</DialogTitle>
          <DialogDescription>
            Pick a response style for your orchestrator. It is saved per user and injected into the system prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 pb-2 sm:grid-cols-2">
          {presets.map((preset) => {
            const isSelected = preset.name === selectedPreset;
            return (
              <button
                key={preset.name}
                className="text-left"
                onClick={() => setSelectedPreset(preset.name)}
                type="button"
              >
                <Card
                  className={cn(
                    "h-full transition-colors hover:border-primary/40",
                    isSelected && "border-primary bg-primary/5 ring-2 ring-primary/20",
                  )}
                >
                  <CardContent className="space-y-3 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl" aria-hidden="true">
                        {PERSONALITY_EMOJI[preset.name] ?? "✨"}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{preset.label}</p>
                        <p className="text-xs text-muted-foreground">/{preset.name}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">
                      {preset.example}
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        <DialogFooter className="items-center justify-between gap-3 px-6" showCloseButton>
          <div className="min-h-5 flex-1 text-xs text-muted-foreground">
            {error ? <span className="text-destructive">{error}</span> : selectedMeta ? `Selected: ${selectedMeta.label}` : null}
          </div>
          <Button onClick={() => void applyPreset()} disabled={isSaving || presets.length === 0}>
            {isSaving ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
