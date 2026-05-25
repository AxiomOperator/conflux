"use client";

import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ProvidersPage } from "@/components/providers-page";
import { StatusBadge } from "@/components/status-badge";
import { ToolsSection } from "@/components/tools-section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type AdminStats,
  createApiClient,
  type EvolutionCandidate,
  type Provider,
  type ToolRecord,
  type UserRecord,
} from "@/lib/api";

export function AdminPage({
  candidates,
  isAdmin,
  providers,
  stats,
  users,
  tools,
}: {
  candidates: EvolutionCandidate[];
  isAdmin: boolean;
  providers: Provider[];
  stats: AdminStats | null;
  users: UserRecord[];
  tools: ToolRecord[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [userActionId, setUserActionId] = useState<string | null>(null);

  async function handleUserUpdate(
    userId: string,
    patch: { is_admin?: boolean; is_active?: boolean },
  ) {
    try {
      setUserActionId(userId);
      setError(null);
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update user.",
      );
    } finally {
      setUserActionId(null);
    }
  }

  const userColumns = useMemo<DataTableColumn<UserRecord>[]>(
    () => [
      {
        header: "User",
        key: "display_name",
        render: (user) => (
          <div>
            <p className="font-medium">{user.display_name || user.email}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        ),
        sortable: true,
        sortValue: (user) => user.display_name || user.email,
      },
      {
        header: "Role",
        key: "role",
        render: (user) => (
          <div className="flex items-center gap-2">
            <select
              className="flex h-9 min-w-32 rounded-lg border border-input bg-background px-3 text-sm"
              value={user.role}
              disabled={userActionId === user.id}
              onChange={(e) =>
                void handleUserUpdate(user.id, {
                  is_admin: e.target.value === "admin",
                })
              }
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </div>
        ),
        sortable: true,
        sortValue: (user) => user.role,
      },
      {
        header: "Status",
        key: "is_active",
        render: (user) => (
          <button
            className="cursor-pointer"
            disabled={userActionId === user.id}
            title={user.is_active ? "Click to disable" : "Click to enable"}
            onClick={() =>
              void handleUserUpdate(user.id, { is_active: !user.is_active })
            }
          >
            <StatusBadge status={user.is_active ? "active" : "idle"} />
          </button>
        ),
        sortable: true,
        sortValue: (user) => (user.is_active ? 1 : 0),
      },
    ],
    [],
  );

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>
            This section is only available to Conflux administrators.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-muted-foreground">
          <ShieldAlert className="size-5" />
          Sign in with an admin account to manage users and evolution approvals.
        </CardContent>
      </Card>
    );
  }

  async function handleApprove(candidateId: string) {
    if (!session?.accessToken) {
      setError("No active session token was found.");
      return;
    }

    try {
      setError(null);
      setWorkingId(candidateId);
      await createApiClient(session.accessToken).admin.approveCandidate(
        candidateId,
      );
      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Failed to approve evolution candidate.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  const statCards = [
    { label: "Total runs", value: stats?.total_runs ?? 0 },
    { label: "Completed runs", value: stats?.completed_runs ?? 0 },
    { label: "Running runs", value: stats?.running_runs ?? 0 },
    { label: "Pending skills", value: stats?.pending_skills ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage users and approve system-generated evolution candidates.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">
              {stat.value}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Role visibility and account state across the tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={userColumns}
            data={users}
            emptyMessage="No users found."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evolution candidates pending approval</CardTitle>
          <CardDescription>
            Review proposed improvements before they are promoted into
            production skills.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {candidates.length > 0 ? (
            candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{candidate.type}</h3>
                      <StatusBadge status={candidate.approval_status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {candidate.rationale || "No rationale provided."}
                    </p>
                    <p className="text-sm">
                      Eval score: {candidate.eval_score ?? "—"}
                    </p>
                  </div>
                  <Button
                    disabled={workingId === candidate.id}
                    onClick={() => void handleApprove(candidate.id)}
                  >
                    {workingId === candidate.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                    Approve candidate
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No pending evolution candidates.
            </p>
          )}
        </CardContent>
      </Card>

      <ProvidersPage isAdmin={true} providers={providers} />

      <ToolsSection initialTools={tools} />
    </div>
  );
}
