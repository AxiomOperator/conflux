import { RunsPage } from "@/components/runs-page";
import { createServerApiClient } from "@/lib/server-api";

export default async function RunsDashboardPage() {
  const client = await createServerApiClient();
  const [runs, agents] = await Promise.all([
    client.runs.list(50).catch(() => []),
    client.agents.list().catch(() => []),
  ]);

  return <RunsPage runs={runs} agents={agents} />;
}
