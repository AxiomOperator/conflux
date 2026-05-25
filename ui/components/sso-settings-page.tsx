"use client";

import { Check, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SsoProvider {
  provider: string;
  enabled: boolean;
  configured: boolean;
}

interface CredentialsUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
}

interface CreateUserPayload {
  email: string;
  display_name: string;
  password: string;
  is_admin: boolean;
}

const PROVIDER_META: Record<
  string,
  { label: string; description: string; envVars: string[] }
> = {
  "azure-ad": {
    label: "Microsoft Entra ID",
    description: "Sign in with Microsoft Azure Active Directory accounts.",
    envVars: ["AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET", "AZURE_AD_TENANT_ID"],
  },
  github: {
    label: "GitHub",
    description: "Sign in with GitHub OAuth.",
    envVars: ["GITHUB_ID", "GITHUB_SECRET"],
  },
  google: {
    label: "Google",
    description: "Sign in with Google OAuth.",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  oidc: {
    label: "Generic OIDC",
    description: "Sign in with any OpenID Connect provider (Okta, Keycloak, Auth0, etc.).",
    envVars: ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_ISSUER"],
  },
  credentials: {
    label: "Username / Password",
    description: "Email + password accounts created directly by admins.",
    envVars: [],
  },
};

function ProviderCard({
  provider,
  onToggle,
}: {
  provider: SsoProvider;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const meta = PROVIDER_META[provider.provider] ?? {
    label: provider.provider,
    description: "",
    envVars: [],
  };

  async function handleToggle(checked: boolean) {
    setPending(true);
    try {
      await onToggle(provider.provider, checked);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{meta.label}</CardTitle>
          <CardDescription className="text-sm">{meta.description}</CardDescription>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={provider.enabled}
              onCheckedChange={handleToggle}
              disabled={!provider.configured}
              aria-label={`Toggle ${meta.label}`}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 overflow-hidden">
        <Badge variant={provider.enabled ? "default" : "secondary"}>
          {provider.enabled ? "Enabled" : "Disabled"}
        </Badge>
        <Badge variant={provider.configured ? "outline" : "secondary"}>
          {provider.configured ? (
            <span className="flex items-center gap-1">
              <Check className="size-3" />
              Configured
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              <X className="size-3" />
              Not configured
            </span>
          )}
        </Badge>
        {!provider.configured && meta.envVars.length > 0 && (
          <div className="mt-1 w-full space-y-1">
            <p className="text-xs text-muted-foreground">Required env vars:</p>
            <div className="flex flex-wrap gap-1">
              {meta.envVars.map((v) => (
                <code key={v} className="rounded bg-muted px-1 py-0.5 text-[11px] break-all">
                  {v}
                </code>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateUserPayload>({
    email: "",
    display_name: "",
    password: "",
    is_admin: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/sso-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? "Failed to create user");
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Credentials User</DialogTitle>
          <DialogDescription>
            Create a new user who signs in with email and password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Display Name</Label>
            <Input
              id="new-name"
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              disabled={pending}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="new-admin"
              checked={form.is_admin}
              onCheckedChange={(c) => setForm({ ...form, is_admin: c })}
              disabled={pending}
            />
            <Label htmlFor="new-admin">Admin user</Label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SsoSettingsPage() {
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [credUsers, setCredUsers] = useState<CredentialsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prRes, usersRes] = await Promise.all([
        fetch("/api/sso-settings"),
        fetch("/api/admin/sso-users"),
      ]);
      if (prRes.ok) setProviders(await prRes.json());
      if (usersRes.ok) setCredUsers(await usersRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleToggle(providerId: string, enabled: boolean) {
    await fetch("/api/sso-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, enabled }),
    });
    setProviders((prev) =>
      prev.map((p) => (p.provider === providerId ? { ...p, enabled } : p))
    );
  }

  async function handleDeleteUser(userId: string) {
    setDeletingId(userId);
    try {
      await fetch(`/api/admin/sso-users/${userId}`, { method: "DELETE" });
      setCredUsers((prev) => prev.filter((u) => u.id !== userId));
    } finally {
      setDeletingId(null);
    }
  }

  const credentialsEnabled = providers.some(
    (p) => p.provider === "credentials" && p.enabled
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SSO Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure which sign-in methods are available to users.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading providers…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => (
            <ProviderCard key={p.provider} provider={p} onToggle={handleToggle} />
          ))}
        </div>
      )}

      {credentialsEnabled && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Credentials Users</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Users who sign in with email and password.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />
              New User
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credUsers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-6"
                  >
                    No credentials users yet.
                  </TableCell>
                </TableRow>
              ) : (
                credUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>
                      <Badge variant={u.is_admin ? "default" : "secondary"}>
                        {u.is_admin ? "Admin" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteUser(u.id)}
                        disabled={deletingId === u.id}
                      >
                        {deletingId === u.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}

      <CreateUserDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={loadData}
      />
    </div>
  );
}
