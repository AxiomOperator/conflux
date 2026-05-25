import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default async function ProvidersDashboardPage() {
  redirect("/admin");
}

