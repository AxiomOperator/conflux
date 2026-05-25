"use client";

import {
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Separator } from "@/components/ui/separator";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SettingCategory =
  | "core"
  | "embeddings"
  | "search"
  | "voice"
  | "messaging"
  | "features"
  | "integrations";

type SettingType = "string" | "bool" | "int" | "list";

interface SettingOut {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  sensitive: boolean;
  setting_type: SettingType;
  env_value: string | null;
  db_value: string | null;
  effective_value: string | null;
  has_db_override: boolean;
}

interface ToastState {
  title: string;
  tone?: "success" | "error";
}

const CATEGORY_OPTIONS: Array<{ id: "all" | SettingCategory; label: string }> =
  [
    { id: "all", label: "All" },
    { id: "core", label: "Core" },
    { id: "embeddings", label: "Embeddings" },
    { id: "search", label: "Search" },
    { id: "voice", label: "Voice" },
    { id: "messaging", label: "Messaging" },
    { id: "features", label: "Features" },
    { id: "integrations", label: "Integrations" },
  ];

const CATEGORY_STYLES: Record<SettingCategory, string> = {
  core: "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200",
  embeddings:
    "border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  search:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  voice:
    "border-cyan-200 bg-cyan-100 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300",
  messaging:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  features:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  integrations:
    "border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
};

function formatValue(value: string | null) {
  return value && value.length > 0 ? value : "not set";
}

function parseBool(value: string | null | undefined) {
  return value === "true" || value === "1";
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
    message?: string;
  } | null;
  return data?.detail ?? data?.error ?? data?.message ?? fallback;
}

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function serializeList(items: string[]): string {
  return items.join(",");
}

interface ListChipInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

function ListChipInput({ value, onChange, disabled, placeholder, "aria-label": ariaLabel }: ListChipInputProps) {
  const [draft, setDraft] = useState("");
  const items = parseList(value);

  function addItem(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange(serializeList([...items, trimmed]));
    setDraft("");
  }

  function removeItem(index: number) {
    const next = items.filter((_, i) => i !== index);
    onChange(serializeList(next));
  }

  return (
    <div
      className="flex min-h-10 flex-1 flex-wrap gap-1.5 rounded-md border bg-background px-3 py-2"
      aria-label={ariaLabel}
    >
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-mono"
        >
          {item}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${item}`}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          type="text"
          className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={draft}
          placeholder={items.length === 0 ? placeholder : "Add ID…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              addItem(draft);
            } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
              removeItem(items.length - 1);
            }
          }}
          onBlur={() => addItem(draft)}
        />
      )}
    </div>
  );
}

export function SystemSettingsPage() {
  const [settings, setSettings] = useState<SettingOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<"all" | SettingCategory>(
    "all",
  );
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>(
    {},
  );
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    restored: Record<string, number>;
  } | null>(null);
  const [restoreInputKey, setRestoreInputKey] = useState(0);

  const toast = useCallback((next: ToastState) => {
    setToastState(next);
  }, []);

  useEffect(() => {
    if (!toastState) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToastState(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toastState]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/settings", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load settings."),
        );
      }

      const data = (await response.json()) as SettingOut[];
      setSettings(Array.isArray(data) ? data : []);
      setEditValues(
        (Array.isArray(data) ? data : []).reduce<Record<string, string>>(
          (acc, setting) => {
            if (setting.has_db_override && setting.db_value !== null) {
              acc[setting.key] = setting.db_value;
            }
            return acc;
          },
          {},
        ),
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load settings.",
      );
      setSettings([]);
      setEditValues({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const groupedSettings = useMemo(() => {
    const byCategory = new Map<SettingCategory, SettingOut[]>();
    for (const option of CATEGORY_OPTIONS) {
      if (option.id !== "all") {
        byCategory.set(option.id, []);
      }
    }

    const filtered = settings
      .filter(
        (setting) =>
          activeCategory === "all" || setting.category === activeCategory,
      )
      .sort((left, right) => left.label.localeCompare(right.label));

    for (const setting of filtered) {
      const group = byCategory.get(setting.category);
      if (group) {
        group.push(setting);
      }
    }

    if (activeCategory !== "all") {
      return [
        {
          category: activeCategory,
          settings: byCategory.get(activeCategory) ?? [],
        },
      ];
    }

    return CATEGORY_OPTIONS.filter((option) => option.id !== "all")
      .map((option) => {
        const category = option.id as SettingCategory;
        return {
          category,
          settings: byCategory.get(category) ?? [],
        };
      })
      .filter((group) => group.settings.length > 0);
  }, [activeCategory, settings]);

  const updateEditValue = useCallback((key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function saveSetting(key: string, value: string) {
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const response = await fetch(
        `/api/admin/settings/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to save setting."),
        );
      }
      await loadSettings();
      toast({ title: "Setting saved" });
    } catch (saveError) {
      toast({
        title:
          saveError instanceof Error
            ? saveError.message
            : "Failed to save setting.",
        tone: "error",
      });
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function resetSetting(key: string) {
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const response = await fetch(
        `/api/admin/settings/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to reset setting."),
        );
      }
      await loadSettings();
      toast({ title: "Reset to default" });
    } catch (resetError) {
      toast({
        title:
          resetError instanceof Error
            ? resetError.message
            : "Failed to reset setting.",
        tone: "error",
      });
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleDownloadBackup() {
    setDownloading(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Backup failed."));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `conflux-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded" });
    } catch (downloadError) {
      toast({
        title:
          downloadError instanceof Error
            ? downloadError.message
            : "Backup failed.",
        tone: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function handleRestore() {
    if (!selectedFile) {
      return;
    }

    setRestoring(true);
    setRestoreResult(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);

      const response = await fetch("/api/backup/restore", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => null)) as {
        detail?: string;
        error?: string;
        message?: string;
        restored?: Record<string, number>;
      } | null;

      if (!response.ok) {
        throw new Error(
          data?.detail ?? data?.error ?? data?.message ?? "Restore failed.",
        );
      }

      setRestoreResult({ restored: data?.restored ?? {} });
      setSelectedFile(null);
      setRestoreInputKey((prev) => prev + 1);
      await loadSettings();
      toast({ title: "Backup restored" });
    } catch (restoreError) {
      toast({
        title:
          restoreError instanceof Error
            ? restoreError.message
            : "Restore failed.",
        tone: "error",
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          System Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Runtime configuration — DB values override .env defaults
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-muted/30 p-2">
        {CATEGORY_OPTIONS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={activeCategory === option.id ? "secondary" : "ghost"}
            onClick={() => setActiveCategory(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading settings…
        </div>
      ) : null}

      {!loading && groupedSettings.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No settings found for this category.
          </CardContent>
        </Card>
      ) : null}

      {!loading
        ? groupedSettings.map((group) => (
            <section key={group.category} className="space-y-4">
              {activeCategory === "all" ? (
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {
                      CATEGORY_OPTIONS.find(
                        (option) => option.id === group.category,
                      )?.label
                    }
                  </h2>
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                {group.settings.map((setting) => {
                  const currentEditValue = editValues[setting.key] ?? "";
                  const hasEditValue = Object.hasOwn(editValues, setting.key);
                  const isSaving = Boolean(saving[setting.key]);
                  const canSave =
                    hasEditValue &&
                    currentEditValue !== (setting.db_value ?? "");
                  const boolValue = hasEditValue
                    ? parseBool(currentEditValue)
                    : parseBool(setting.effective_value ?? setting.env_value);
                  const inputType = setting.sensitive
                    ? showSensitive[setting.key]
                      ? "text"
                      : "password"
                    : setting.setting_type === "int"
                      ? "number"
                      : "text";

                  return (
                    <Card key={setting.key} className="h-full">
                      <CardHeader className="space-y-3 pb-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={CATEGORY_STYLES[setting.category]}
                          >
                            {
                              CATEGORY_OPTIONS.find(
                                (option) => option.id === setting.category,
                              )?.label
                            }
                          </Badge>
                          {setting.has_db_override ? (
                            <Badge className="border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                              DB Override active
                            </Badge>
                          ) : null}
                          {setting.sensitive ? (
                            <Badge variant="secondary">Sensitive</Badge>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <CardTitle className="text-base">
                            {setting.label}
                          </CardTitle>
                          <CardDescription>
                            {setting.description}
                          </CardDescription>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Env default
                            </p>
                            <p className="mt-1 break-all font-mono text-sm">
                              {formatValue(setting.env_value)}
                            </p>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              DB override
                            </p>
                            <p
                              className={cn(
                                "mt-1 break-all font-mono text-sm",
                                !setting.has_db_override &&
                                  "text-muted-foreground",
                              )}
                            >
                              {setting.has_db_override
                                ? formatValue(setting.db_value)
                                : "Not set"}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-lg border bg-muted/10 p-3 text-sm text-muted-foreground">
                          Effective value:{" "}
                          {formatValue(setting.effective_value)}
                        </div>

                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                          {setting.setting_type === "bool" ? (
                            <div className="flex min-h-10 flex-1 items-center justify-between rounded-lg border px-3 py-2">
                              <div>
                                <div className="text-sm font-medium text-foreground">
                                  {boolValue ? "Enabled" : "Disabled"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {hasEditValue
                                    ? "Unsaved override value"
                                    : setting.has_db_override
                                      ? "Stored DB override"
                                      : "Using env default"}
                                </div>
                              </div>
                              <Switch
                                checked={boolValue}
                                onCheckedChange={(checked) =>
                                  updateEditValue(setting.key, String(checked))
                                }
                                disabled={isSaving}
                                aria-label={`Toggle ${setting.label}`}
                              />
                            </div>
                          ) : setting.setting_type === "list" ? (
                            <ListChipInput
                              value={hasEditValue ? currentEditValue : (setting.effective_value ?? setting.env_value ?? "")}
                              onChange={(val) => updateEditValue(setting.key, val)}
                              disabled={isSaving}
                              placeholder="Type an ID and press Enter…"
                              aria-label={setting.label}
                            />
                          ) : (
                            <div className="flex flex-1 items-center gap-2">
                              <Input
                                type={inputType}
                                step={
                                  setting.setting_type === "int" ? 1 : undefined
                                }
                                value={currentEditValue}
                                placeholder={
                                  setting.has_db_override
                                    ? undefined
                                    : (setting.env_value ?? "not set")
                                }
                                onChange={(event) =>
                                  updateEditValue(
                                    setting.key,
                                    event.target.value,
                                  )
                                }
                                disabled={isSaving}
                                aria-label={setting.label}
                              />
                              {setting.sensitive ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon-sm"
                                  onClick={() =>
                                    setShowSensitive((prev) => ({
                                      ...prev,
                                      [setting.key]: !prev[setting.key],
                                    }))
                                  }
                                  aria-label={
                                    showSensitive[setting.key]
                                      ? `Hide ${setting.label}`
                                      : `Show ${setting.label}`
                                  }
                                >
                                  {showSensitive[setting.key] ? (
                                    <EyeOff className="size-4" />
                                  ) : (
                                    <Eye className="size-4" />
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          )}

                          <div className="flex gap-2 lg:shrink-0">
                            <Button
                              type="button"
                              onClick={() =>
                                void saveSetting(setting.key, currentEditValue)
                              }
                              disabled={!canSave || isSaving}
                            >
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Save className="size-4" />
                              )}
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void resetSetting(setting.key)}
                              disabled={!setting.has_db_override || isSaving}
                            >
                              <RefreshCw className="size-4" />
                              Reset
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        : null}

      <Card>
        <CardHeader>
          <CardTitle>Backup &amp; Restore</CardTitle>
          <CardDescription>
            Export your configuration to a JSON file or restore from a previous
            backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-medium">Create Backup</h3>
            <p className="text-sm text-muted-foreground">
              Downloads a JSON file containing all system settings, providers,
              agents, skills, and user configuration.
            </p>
            <Button onClick={() => void handleDownloadBackup()} disabled={downloading}>
              {downloading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              {downloading ? "Creating backup…" : "Download Backup"}
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="font-medium">Restore from Backup</h3>
            <p className="text-sm text-muted-foreground">
              Upload a previously exported backup file to restore your
              configuration.
              <strong className="text-amber-600 dark:text-amber-400">
                {" "}This will overwrite existing settings.
              </strong>
            </p>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                key={restoreInputKey}
                type="file"
                accept=".json"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setRestoreResult(null);
                }}
                className="max-w-xs"
              />
              <Button
                variant="destructive"
                onClick={() => void handleRestore()}
                disabled={!selectedFile || restoring}
              >
                {restoring ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                {restoring ? "Restoring…" : "Restore"}
              </Button>
            </div>
            {restoreResult ? (
              <p className="text-sm text-muted-foreground">
                Restored:{" "}
                {Object.entries(restoreResult.restored ?? {})
                  .map(([key, value]) => `${value} ${key}`)
                  .join(", ") || "nothing"}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

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
