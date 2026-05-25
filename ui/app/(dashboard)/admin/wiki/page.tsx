import { WikiAdminPage } from "@/components/wiki-admin-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";
export const metadata = { title: "Wiki - Admin | Conflux" };

export default async function AdminWikiPage() {
  const session = await auth();
  const azureOid = session?.user?.id;
  const email = session?.user?.email ?? undefined;
  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);
  const dbUser = me
    ? null
    : azureOid
      ? await getUserByOid(azureOid, email).catch(() => null)
      : null;
  const effectiveIsAdmin = isEffectiveAdmin(me, dbUser?.is_admin ?? false);

  if (!effectiveIsAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You do not have permission to access this page.
      </div>
    );
  }

  return <WikiAdminPage />;
}
