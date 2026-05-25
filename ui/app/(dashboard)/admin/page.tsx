import { AdminPage } from "@/components/admin-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getProviders, getUserByOid, getUsers } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";

export default async function AdminDashboardPage() {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);

  // Always use DB as source of truth for admin status when backend lookup fails.
  const dbUser = me
    ? null
    : azure_oid
      ? await getUserByOid(azure_oid, email).catch(() => null)
      : null;
  const effectiveIsAdmin = isEffectiveAdmin(me, dbUser?.is_admin ?? false);

  if (!effectiveIsAdmin) {
    return (
      <AdminPage
        candidates={[]}
        isAdmin={false}
        providers={[]}
        stats={null}
        users={[]}
        tools={[]}
      />
    );
  }

  // Users and providers come from DB directly — no FastAPI JWT needed.
  const [stats, candidates, providers, rawUsers, tools] = await Promise.all([
    client.admin.stats().catch(() => null),
    client.admin.evolutionCandidates().catch(() => []),
    getProviders()
      .then((rows) =>
        rows.map((provider) => ({
          ...provider,
          healthy: provider.health_status === "healthy",
        })),
      )
      .catch(() => []),
    getUsers().catch(() => []),
    client.tools.list().catch(() => []),
  ]);

  // Map DbUser → UserRecord shape expected by AdminPage
  const users = rawUsers.map((u) => ({
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    is_admin: u.is_admin,
    is_active: u.is_active,
    role: u.is_admin ? ("admin" as const) : ("member" as const),
  }));

  return (
    <AdminPage
      candidates={candidates}
      isAdmin={effectiveIsAdmin}
      providers={providers}
      stats={stats}
      users={users}
      tools={tools}
    />
  );
}
