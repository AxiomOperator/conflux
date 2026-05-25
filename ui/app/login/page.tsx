import { redirect } from "next/navigation";

import { LoginForm, type EnabledProvider } from "@/components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getSSOSettings } from "@/lib/db";

const PROVIDER_LABELS: Record<string, string> = {
  "azure-ad": "Continue with Microsoft",
  github: "Continue with GitHub",
  google: "Continue with Google",
  oidc: `Continue with ${process.env.OIDC_PROVIDER_NAME ?? "SSO"}`,
};

const PROVIDER_ENV_VARS: Record<string, string | undefined> = {
  "azure-ad": process.env.AZURE_AD_CLIENT_ID,
  github: process.env.GITHUB_ID,
  google: process.env.GOOGLE_CLIENT_ID,
  oidc: process.env.OIDC_CLIENT_ID,
  credentials: "always", // credentials is always "configured" when enabled
};

export default async function LoginPage() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  // Fetch which providers are enabled in DB
  const ssoSettings = await getSSOSettings().catch(() => [
    { provider: "azure-ad", enabled: true },
  ]);

  // A provider is shown if: (1) its env vars are set AND (2) it's enabled in DB
  const enabledProviders: EnabledProvider[] = ssoSettings
    .filter((s) => s.enabled && PROVIDER_ENV_VARS[s.provider])
    .map((s) => ({
      id: s.provider,
      label: PROVIDER_LABELS[s.provider] ?? `Continue with ${s.provider}`,
    }));

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_var(--color-muted)_0,_transparent_55%)] p-6">
      <Card className="w-full max-w-md border-border/70 shadow-xl shadow-black/5">
        <CardHeader className="space-y-5 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-lg">
            C
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">Conflux</CardTitle>
            <CardDescription className="text-base">
              Sign in to access the Conflux dashboard.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <LoginForm providers={enabledProviders} />
        </CardContent>
      </Card>
    </main>
  );
}
