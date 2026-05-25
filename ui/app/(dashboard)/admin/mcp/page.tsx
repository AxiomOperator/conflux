import { McpServersPage } from "@/components/mcp-servers-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";

export default async function AdminMcpPage() {
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
  const servers = effectiveIsAdmin
    ? await client.mcp.listServers().catch(() => [])
    : [];

  return <McpServersPage servers={servers} isAdmin={effectiveIsAdmin} />;
}
