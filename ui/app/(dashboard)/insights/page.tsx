import { InsightsPage } from "@/components/insights-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InsightsDashboardPage() {
  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);
  const session = await auth();
  const azureOid = session?.user?.id;
  const email = session?.user?.email ?? undefined;
  const dbUser = me
    ? null
    : azureOid
      ? await getUserByOid(azureOid, email).catch(() => null)
      : null;

  return (
    <InsightsPage isAdmin={isEffectiveAdmin(me, dbUser?.is_admin ?? false)} />
  );
}
