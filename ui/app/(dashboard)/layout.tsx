import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { auth } from "@/lib/auth";
import { getUserByOid, provisionSsoUser } from "@/lib/db";
import { createServerApiClient } from "@/lib/server-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  // Ensure the user exists in the Conflux DB (idempotent upsert).
  const { id: azure_oid, email, name } = session.user ?? {};
  if (azure_oid && email) {
    await provisionSsoUser({
      azure_oid,
      email,
      display_name: name ?? email,
    }).catch((err) => console.error("[conflux] provision error:", err));
  }

  // Try backend first; fall back to direct DB so admin status is always correct.
  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);
  const dbUser = me
    ? null
    : azure_oid
      ? await getUserByOid(azure_oid, email ?? undefined).catch(() => null)
      : null;

  return (
    <>
      <DashboardShell
        user={{
          name:
            me?.display_name ??
            dbUser?.display_name ??
            session.user?.name ??
            "Conflux User",
          email: me?.email ?? dbUser?.email ?? session.user?.email ?? "",
          image: session.user?.image ?? null,
          isAdmin: me?.is_admin ?? dbUser?.is_admin ?? false,
          viewAsUser: me?.view_as_user ?? false,
        }}
      >
        {children}
      </DashboardShell>
      <OnboardingWizard />
    </>
  );
}
