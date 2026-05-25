import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const BACKEND = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function adminHeaders(email: string, extra: Record<string, string> = {}) {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
    ...extra,
  };
}

/** Env vars required per provider — checked server-side since they live in Next.js env */
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  "azure-ad": ["AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET", "AZURE_AD_TENANT_ID"],
  github: ["GITHUB_ID", "GITHUB_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  oidc: ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_ISSUER"],
  credentials: [], // always configured — no env vars needed
};

function isConfigured(provider: string): boolean {
  const vars = PROVIDER_ENV_VARS[provider] ?? [];
  if (vars.length === 0) return true;
  return vars.every((v) => !!process.env[v]);
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${BACKEND}/v1/admin/sso`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json(await res.json(), { status: res.status });

  const data = await res.json() as Array<{ provider: string; enabled: boolean; updated_at?: string }>;
  // Annotate each provider with whether its env vars are present
  const annotated = data.map((p) => ({ ...p, configured: isConfigured(p.provider) }));
  return NextResponse.json(annotated);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const provider = body.provider as string;
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  const res = await fetch(`${BACKEND}/v1/admin/sso/${provider}`, {
    method: "PUT",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled: body.enabled }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
