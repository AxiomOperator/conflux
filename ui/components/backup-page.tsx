"use client";

import { Database, Download, HardDrive, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ToastState {
  title: string;
  tone?: "success" | "error";
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
    message?: string;
  } | null;
  return data?.detail ?? data?.error ?? data?.message ?? fallback;
}

type RestoreResults = {
  config?: Record<string, number | string>;
  postgres?: Record<string, number | string>;
  qdrant?: Record<string, string>;
};

export function BackupPage() {
  // Config backup state
  const [downloading, setDownloading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ restored: Record<string, number> } | null>(null);
  const [restoreInputKey, setRestoreInputKey] = useState(0);

  // Full backup state
  const [fullDownloading, setFullDownloading] = useState(false);
  const [fullSelectedFile, setFullSelectedFile] = useState<File | null>(null);
  const [fullRestoring, setFullRestoring] = useState(false);
  const [fullRestoreResult, setFullRestoreResult] = useState<{ restored: RestoreResults } | null>(null);
  const [fullRestoreInputKey, setFullRestoreInputKey] = useState(0);

  const [toastState, setToastState] = useState<ToastState | null>(null);

  const toast = useCallback((next: ToastState) => {
    setToastState(next);
  }, []);

  useEffect(() => {
    if (!toastState) return undefined;
    const timer = window.setTimeout(() => setToastState(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toastState]);

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
      toast({ title: "Config backup downloaded" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Backup failed.", tone: "error" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleRestore() {
    if (!selectedFile) return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch("/api/backup/restore", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        detail?: string; error?: string; message?: string; restored?: Record<string, number>;
      } | null;
      if (!response.ok) {
        throw new Error(data?.detail ?? data?.error ?? data?.message ?? "Restore failed.");
      }
      setRestoreResult({ restored: data?.restored ?? {} });
      setSelectedFile(null);
      setRestoreInputKey((prev) => prev + 1);
      toast({ title: "Config backup restored" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Restore failed.", tone: "error" });
    } finally {
      setRestoring(false);
    }
  }

  async function handleFullDownload() {
    setFullDownloading(true);
    try {
      const response = await fetch("/api/backup/full", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Full backup failed."));
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `conflux-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Full backup downloaded" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Full backup failed.", tone: "error" });
    } finally {
      setFullDownloading(false);
    }
  }

  async function handleFullRestore() {
    if (!fullSelectedFile) return;
    setFullRestoring(true);
    setFullRestoreResult(null);
    try {
      const form = new FormData();
      form.append("file", fullSelectedFile);
      const response = await fetch("/api/backup/restore/full", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        detail?: string; error?: string; message?: string; restored?: RestoreResults;
      } | null;
      if (!response.ok) {
        throw new Error(data?.detail ?? data?.error ?? data?.message ?? "Full restore failed.");
      }
      setFullRestoreResult({ restored: data?.restored ?? {} });
      setFullSelectedFile(null);
      setFullRestoreInputKey((prev) => prev + 1);
      toast({ title: "Full backup restored" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Full restore failed.", tone: "error" });
    } finally {
      setFullRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backup &amp; Restore</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Export your configuration or restore from a previous backup.
        </p>
      </div>

      {/* ── Full System Backup ──────────────────────────────────────── */}
      <Card className="border-primary/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="size-5 text-primary" />
            <CardTitle>Full System Backup</CardTitle>
          </div>
          <CardDescription>
            Downloads a <strong>.zip</strong> containing app configuration,{" "}
            <strong>all PostgreSQL tables</strong>, and{" "}
            <strong>Qdrant vector snapshots</strong>. Use this before container updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Includes: settings · providers · agents · skills · users · conversations ·
              memories · wiki · traces · audit log · Qdrant collections (documents, memory,
              skills, wiki).
            </p>
            <Button onClick={() => void handleFullDownload()} disabled={fullDownloading}>
              {fullDownloading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              {fullDownloading ? "Creating full backup…" : "Download Full Backup (.zip)"}
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Restore from Full Backup</p>
            <p className="text-sm text-muted-foreground">
              Upload a <code>.zip</code> full backup to restore all data.{" "}
              <strong className="text-amber-600 dark:text-amber-400">
                Existing rows will be overwritten.
              </strong>
            </p>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                key={fullRestoreInputKey}
                type="file"
                accept=".zip"
                onChange={(e) => {
                  setFullSelectedFile(e.target.files?.[0] ?? null);
                  setFullRestoreResult(null);
                }}
                className="max-w-xs"
              />
              <Button
                variant="destructive"
                onClick={() => void handleFullRestore()}
                disabled={!fullSelectedFile || fullRestoring}
              >
                {fullRestoring ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                {fullRestoring ? "Restoring…" : "Restore Full Backup"}
              </Button>
            </div>
            {fullRestoreResult ? (
              <div className="space-y-1 rounded-md bg-muted p-3 text-xs">
                {Object.entries(fullRestoreResult.restored).map(([section, data]) => (
                  <div key={section}>
                    <span className="font-semibold capitalize">{section}:</span>{" "}
                    {typeof data === "object" && data !== null
                      ? Object.entries(data)
                          .slice(0, 5)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ") + (Object.keys(data).length > 5 ? " …" : "")
                      : String(data)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Config-only Backup ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="size-5 text-muted-foreground" />
            <CardTitle>Config-only Backup</CardTitle>
          </div>
          <CardDescription>
            Lightweight JSON backup of app settings, providers, agents, skills, and users.
            Does not include conversation history, memories, or vector data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button onClick={() => void handleDownloadBackup()} disabled={downloading} variant="outline">
            {downloading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            {downloading ? "Creating backup…" : "Download Config Backup (.json)"}
          </Button>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Restore Config Backup</p>
            <p className="text-sm text-muted-foreground">
              Upload a <code>.json</code> config backup.{" "}
              <strong className="text-amber-600 dark:text-amber-400">
                Existing settings will be overwritten.
              </strong>
            </p>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                key={restoreInputKey}
                type="file"
                accept=".json"
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] ?? null);
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
                {restoring ? "Restoring…" : "Restore Config"}
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
                : "border-border text-foreground",
            )}
          >
            {toastState.title}
          </div>
        </div>
      ) : null}
    </div>
  );
}
