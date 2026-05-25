export const runtime = "nodejs";

import { ChatPage } from "@/components/chat-page";
import { createServerApiClient } from "@/lib/server-api";

export const metadata = {
  title: "Chat — Conflux",
};

export default async function ChatDashboardPage() {
  const client = await createServerApiClient();
  const me = await client.users.me().catch(() => null);
  const orchestratorId = me?.workspace?.orchestrator_id ?? null;

  return <ChatPage orchestratorId={orchestratorId} />;
}
