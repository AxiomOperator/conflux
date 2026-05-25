import { BackupPage } from "@/components/backup-page";
import { isEffectiveAdmin } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const runtime = "nodejs";
export const metadata = { title: "Backup & Restore - Admin | Conflux" };

export default async function AdminBackupPage() {
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

  if (!effectiveIsAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You do not have permission to access this page.
      </div>
    );
  }

  return <BackupPage />;
}
