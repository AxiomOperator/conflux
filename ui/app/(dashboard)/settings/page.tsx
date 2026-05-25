import { SettingsPage } from "@/components/settings-page";
import type { PersonaFiles } from "@/lib/api";
import { createServerApiClient } from "@/lib/server-api";

export default async function SettingsDashboardPage() {
  const client = await createServerApiClient();
  const persona = await client.users.getPersona().catch(
    (): PersonaFiles => ({
      agents_md: null,
      soul_md: null,
      user_md: null,
      identity_md: null,
      tools_md: null,
      heartbeat_md: null,
      boot_md: null,
    }),
  );

  return <SettingsPage persona={persona} />;
}
