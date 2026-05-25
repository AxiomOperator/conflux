import { SchedulesPage } from "@/components/schedules-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SchedulesDashboardPage() {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;
  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);
  const dbUser = me
    ? null
    : azure_oid
      ? await getUserByOid(azure_oid, email).catch(() => null)
      : null;
  const effectiveIsAdmin = isEffectiveAdmin(me, dbUser?.is_admin ?? false);

  const [schedules, agents] = await Promise.all([
    client.schedules.list().catch(() => []),
    client.agents.list().catch(() => []),
  ]);

  return (
    <SchedulesPage
      schedules={schedules}
      agents={agents}
      isAdmin={effectiveIsAdmin}
    />
  );
}
