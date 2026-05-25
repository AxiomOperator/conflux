import { DashboardPage } from "@/components/dashboard-page";
import { createServerApiClient } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function DashboardServerPage() {
  const client = await createServerApiClient();
  const [agents, runs, providers, adminStats] = await Promise.all([
    client.agents.list().catch(() => []),
    client.runs.list(10).catch(() => []),
    client.providers.list().catch(() => []),
    client.admin.stats().catch(() => null),
  ]);

  return (
    <DashboardPage
      initialStats={adminStats}
      initialRuns={runs}
      initialAgents={agents}
      providers={providers}
    />
  );
}
