import { notFound } from "next/navigation";

import { RunDetailPage } from "@/components/run-detail-page";
import { createServerApiClient } from "@/lib/server-api";

export default async function RunDetailServerPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const client = await createServerApiClient();
  const [run, agents] = await Promise.all([
    client.runs.get(runId).catch(() => null),
    client.agents.list().catch(() => []),
  ]);

  if (!run) {
    notFound();
  }

  const agentName =
    agents.find((agent) => agent.id === run.agent_id)?.name ?? run.agent_id;

  return <RunDetailPage run={run} agentName={agentName} />;
}

