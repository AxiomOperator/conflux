"use client";

import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import type { Provider, ProviderModelEntry } from "@/lib/api";
import { createApiClient } from "@/lib/api";

const PROVIDER_TYPES = [
  { value: "ollama", label: "Ollama" },
  { value: "vllm", label: "vLLM" },
  { value: "llamacpp", label: "llama.cpp" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "openai_compat", label: "OpenAI Compatible" },
];

export function ProvidersPage({
  providers,
  isAdmin = false,
}: {
  providers: Provider[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  // Edit provider dialog state
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [editForm, setEditForm] = useState({ base_url: "", api_key: "", is_enabled: true });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Model management per-provider
  const { data: session } = useSession();
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModelEntry[]>>({});
  const [loadingModelsId, setLoadingModelsId] = useState<string | null>(null);
  const [addModelForm, setAddModelForm] = useState({ model_name: "", display_name: "", context_length: "" });
  const [addingModel, setAddingModel] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  async function loadProviderModels(providerId: string) {
    if (!session?.accessToken) return;
    setLoadingModelsId(providerId);
    setModelError(null);
    try {
      const models = await createApiClient(session.accessToken).providers.listRegisteredModels(providerId);
      setProviderModels((prev) => ({ ...prev, [providerId]: models }));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to load registered models.");
    } finally {
      setLoadingModelsId(null);
    }
  }

  async function toggleModels(providerId: string) {
    if (expandedModelId === providerId) {
      setExpandedModelId(null);
      return;
    }
    setExpandedModelId(providerId);
    setModelError(null);
    setAddModelForm({ model_name: "", display_name: "", context_length: "" });
    await loadProviderModels(providerId);
  }

  async function handleAddModel(providerId: string) {
    if (!session?.accessToken || !addModelForm.model_name.trim()) return;
    setAddingModel(true);
    setModelError(null);
    try {
      await createApiClient(session.accessToken).providers.addModel(providerId, {
        model_name: addModelForm.model_name.trim(),
        display_name: addModelForm.display_name.trim() || undefined,
        context_length: addModelForm.context_length ? Number(addModelForm.context_length) : undefined,
      });
      setAddModelForm({ model_name: "", display_name: "", context_length: "" });
      await loadProviderModels(providerId);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to add model.");
    } finally {
      setAddingModel(false);
    }
  }

  async function handleRemoveModel(providerId: string, modelId: string) {
    if (!session?.accessToken) return;
    setDeletingModelId(modelId);
    try {
      await createApiClient(session.accessToken).providers.removeModel(providerId, modelId);
      setProviderModels((prev) => ({
        ...prev,
        [providerId]: (prev[providerId] ?? []).filter((m) => m.id !== modelId),
      }));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to remove model.");
    } finally {
      setDeletingModelId(null);
    }
  }
  const [form, setForm] = useState({
    name: "",
    provider_type: "ollama",
    base_url: "",
    default_model: "",
    api_key: "",
  });

  async function deleteProvider(providerId: string) {
    if (!confirm("Delete this provider? This cannot be undone.")) return;
    try {
      setError(null);
      setDeletingId(providerId);
      const res = await fetch(`/api/providers/${providerId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete provider.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function openEditDialog(provider: Provider) {
    setEditProvider(provider);
    setEditForm({
      base_url: provider.base_url ?? "",
      api_key: "",
      is_enabled: provider.enabled ?? true,
    });
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editProvider?.id || !session?.accessToken) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await createApiClient(session.accessToken).providers.update(editProvider.id, {
        base_url: editForm.base_url.trim() || undefined,
        api_key: editForm.api_key || undefined,
        is_enabled: editForm.is_enabled,
      });
      setEditProvider(null);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update provider.");
    } finally {
      setEditSaving(false);
    }
  }

  async function fetchModels() {
    const baseUrl = form.base_url.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      setModelFetchError("Enter a Base URL first.");
      return;
    }
    setFetchingModels(true);
    setModelFetchError(null);
    setAvailableModels([]);
    setForm((f) => ({ ...f, default_model: "" }));
    try {
      const res = await fetch(
        `/api/providers/probe-models?base_url=${encodeURIComponent(baseUrl)}`,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { models: string[] };
      if (!data.models.length) throw new Error("No models found at that URL.");
      setAvailableModels(data.models);
    } catch (err) {
      setModelFetchError(
        err instanceof Error ? err.message : "Failed to fetch models.",
      );
    } finally {
      setFetchingModels(false);
    }
  }

  function resetAddDialog() {
    setForm({
      name: "",
      provider_type: "ollama",
      base_url: "",
      default_model: "",
      api_key: "",
    });
    setAvailableModels([]);
    setModelFetchError(null);
  }

  async function refreshProvider(providerId?: string) {
    try {
      setError(null);
      if (providerId) {
        setRefreshingId(providerId);
        const res = await fetch(`/api/providers/${providerId}/health-check`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            detail?: string;
          };
          throw new Error(err.detail ?? `HTTP ${res.status}`);
        }
      } else {
        setRefreshingAll(true);
        await Promise.all(
          providers
            .map((p) => p.id)
            .filter((id): id is string => Boolean(id))
            .map(async (id) => {
              const res = await fetch(`/api/providers/${id}/health-check`, {
                method: "POST",
              });
              if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as {
                  detail?: string;
                };
                throw new Error(err.detail ?? `HTTP ${res.status}`);
              }
            }),
        );
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to refresh provider health.",
      );
    } finally {
      setRefreshingId(null);
      setRefreshingAll(false);
    }
  }

  async function addProvider() {
    if (!form.name || !form.base_url) {
      setError("Name and Base URL are required.");
      return;
    }
    try {
      setAdding(true);
      setError(null);
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      setAddOpen(false);
      resetAddDialog();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="text-sm text-muted-foreground">
            Manage downstream LLM providers and check health status.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddDialog(); }}>
              <DialogTrigger asChild>
                <Button variant="default">
                  <Plus className="size-4" />
                  Add Provider
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add LLM Provider</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="provider-name"
                    >
                      Name
                    </label>
                    <Input
                      id="provider-name"
                      placeholder="my-ollama"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="provider-type"
                    >
                      Provider Type
                    </label>
                    <Select
                      value={form.provider_type}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, provider_type: v }))
                      }
                    >
                      <SelectTrigger id="provider-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDER_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="provider-base-url"
                    >
                      Base URL
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="provider-base-url"
                        placeholder="http://192.168.1.100:11434/v1"
                        value={form.base_url}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, base_url: e.target.value }));
                          setAvailableModels([]);
                          setModelFetchError(null);
                          setForm((f) => ({ ...f, default_model: "" }));
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={fetchingModels || !form.base_url.trim()}
                        onClick={() => void fetchModels()}
                      >
                        {fetchingModels ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Search className="size-4" />
                        )}
                      </Button>
                    </div>
                    {modelFetchError ? (
                      <p className="text-xs text-destructive">{modelFetchError}</p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="provider-default-model"
                    >
                      Default Model
                    </label>
                    {availableModels.length > 0 ? (
                      <Select
                        value={form.default_model}
                        onValueChange={(v) =>
                          setForm((f) => ({ ...f, default_model: v }))
                        }
                      >
                        <SelectTrigger id="provider-default-model">
                          <SelectValue placeholder="Pick a model…" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Click the search button above to load available models.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-medium"
                      htmlFor="provider-api-key"
                    >
                      API Key{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                      id="provider-api-key"
                      type="password"
                      placeholder="sk-..."
                      value={form.api_key}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, api_key: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void addProvider()} disabled={adding}>
                    {adding ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Add Provider
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Button
            onClick={() => void refreshProvider()}
            disabled={refreshingAll}
            variant="outline"
          >
            {refreshingAll ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh health
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {providers.length > 0 ? (
          providers.map((provider) => (
            <Card key={provider.name}>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{provider.name}</CardTitle>
                    <CardDescription>{provider.provider_type}</CardDescription>
                  </div>
                  <StatusBadge
                    status={
                      provider.healthy
                        ? "healthy"
                        : (provider.health_status ?? "unknown")
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Base URL</p>
                  <p className="break-all font-medium">{provider.base_url}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Default model</p>
                  <p className="font-medium">{provider.default_model || "—"}</p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!provider.id || refreshingId === provider.id}
                  onClick={() => void refreshProvider(provider.id)}
                >
                  {refreshingId === provider.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Re-check health
                </Button>
                {isAdmin && provider.id && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => openEditDialog(provider)}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive hover:bg-destructive/10"
                      disabled={deletingId === provider.id}
                      onClick={() => void deleteProvider(provider.id!)}
                    >
                      {deletingId === provider.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Delete
                    </Button>
                  </div>
                )}
                {/* ── Registered model management ── */}
                {provider.id && (
                  <div className="border-t pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                      onClick={() => void toggleModels(provider.id!)}
                    >
                      <span>Registered models</span>
                      {expandedModelId === provider.id ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </Button>
                    {expandedModelId === provider.id && (
                      <div className="mt-2 space-y-2">
                        {loadingModelsId === provider.id ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Loading…
                          </div>
                        ) : (providerModels[provider.id] ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No models registered.</p>
                        ) : (
                          <ul className="space-y-1">
                            {(providerModels[provider.id] ?? []).map((m) => (
                              <li
                                key={m.id}
                                className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                              >
                                <span className="font-mono">{m.display_name ?? m.model_name}</span>
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5"
                                    disabled={deletingModelId === m.id}
                                    onClick={() => void handleRemoveModel(provider.id!, m.id)}
                                  >
                                    {deletingModelId === m.id ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <Trash2 className="size-3 text-destructive" />
                                    )}
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {isAdmin && (
                          <div className="space-y-2 rounded-md border p-2">
                            <p className="text-xs font-medium text-muted-foreground">Add model</p>
                            <Input
                              className="h-7 text-xs"
                              placeholder="Model name (e.g. llama3.2)"
                              value={addModelForm.model_name}
                              onChange={(e) =>
                                setAddModelForm((p) => ({ ...p, model_name: e.target.value }))
                              }
                            />
                            <Input
                              className="h-7 text-xs"
                              placeholder="Display name (optional)"
                              value={addModelForm.display_name}
                              onChange={(e) =>
                                setAddModelForm((p) => ({ ...p, display_name: e.target.value }))
                              }
                            />
                            <Input
                              className="h-7 text-xs"
                              placeholder="Context length (optional)"
                              type="number"
                              value={addModelForm.context_length}
                              onChange={(e) =>
                                setAddModelForm((p) => ({ ...p, context_length: e.target.value }))
                              }
                            />
                            {modelError ? (
                              <p className="text-xs text-destructive">{modelError}</p>
                            ) : null}
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={addingModel || !addModelForm.model_name.trim()}
                              onClick={() => void handleAddModel(provider.id!)}
                            >
                              {addingModel ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Plus className="size-3" />
                              )}
                              Add
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No providers configured yet.
              {isAdmin ? ' Use "Add Provider" to add one.' : ""}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Edit Provider Dialog ── */}
      <Dialog open={!!editProvider} onOpenChange={(open) => { if (!open) setEditProvider(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Provider — {editProvider?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="edit-base-url">Base URL</Label>
              <Input
                id="edit-base-url"
                value={editForm.base_url}
                onChange={(e) => setEditForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="http://192.168.1.1:11434"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-api-key">API Key <span className="text-muted-foreground text-xs">(leave blank to keep existing)</span></Label>
              <Input
                id="edit-api-key"
                type="password"
                value={editForm.api_key}
                onChange={(e) => setEditForm((f) => ({ ...f, api_key: e.target.value }))}
                placeholder="sk-…"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="edit-enabled"
                checked={editForm.is_enabled}
                onCheckedChange={(v) => setEditForm((f) => ({ ...f, is_enabled: v }))}
              />
              <Label htmlFor="edit-enabled">Enabled</Label>
            </div>
            {editError && <p className="text-xs text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditProvider(null)}>Cancel</Button>
            <Button onClick={() => void handleEditSave()} disabled={editSaving}>
              {editSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
