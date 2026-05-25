import { PlaygroundPage } from "@/components/playground-page";
import { getProviderModels } from "@/lib/db";

export const runtime = "nodejs";

export default async function PlaygroundDashboardPage() {
  const models = await getProviderModels().catch(() => []);
  return <PlaygroundPage models={models} />;
}

