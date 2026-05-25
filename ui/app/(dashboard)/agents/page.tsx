import { AgentsPage } from "@/components/agents-page";
import { createServerApiClient } from "@/lib/server-api";

export default async function AgentsDashboardPage() {
  const client = await createServerApiClient();
  const agents = await client.agents.list().catch(() => []);
  return <AgentsPage agents={agents} />;
}
