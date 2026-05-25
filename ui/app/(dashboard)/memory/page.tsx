import { MemoryPage } from "@/components/memory-page";
import { createServerApiClient } from "@/lib/server-api";

export default async function MemoryDashboardPage() {
  const client = await createServerApiClient();
  const [userEntries, sessionEntries, globalEntries] = await Promise.all([
    client.memory.list("user").catch(() => []),
    client.memory.list("session").catch(() => []),
    client.memory.list("global").catch(() => []),
  ]);

  return (
    <MemoryPage
      entries={[...userEntries, ...sessionEntries, ...globalEntries]}
    />
  );
}
