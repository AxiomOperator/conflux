export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDb, getUserByOid } from "@/lib/db";

type CreateProviderBody = {
  api_key?: string;
  base_url?: string;
  default_model?: string;
  name?: string;
  provider_type?: string;
};

type ProviderInsertRow = {
  id: string;
  name: string;
};

export async function POST(request: Request) {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!azure_oid) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getUserByOid(azure_oid, email).catch(() => null);
  if (!dbUser?.is_admin) {
    return NextResponse.json(
      { detail: "Admin access required" },
      { status: 403 },
    );
  }

  let body: CreateProviderBody;
  try {
    body = (await request.json()) as CreateProviderBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  const providerType = body.provider_type?.trim();
  const baseUrl = body.base_url?.trim();
  const defaultModel = body.default_model?.trim();
  const apiKey = body.api_key?.trim() || null;

  if (!name || !providerType || !baseUrl) {
    return NextResponse.json(
      { detail: "name, base_url, and provider_type are required" },
      { status: 400 },
    );
  }

  const sql = getDb();

  try {
    const [provider] = await sql<ProviderInsertRow[]>`
      INSERT INTO providers (name, provider_type, base_url, api_key)
      VALUES (${name}, ${providerType}, ${baseUrl}, ${apiKey})
      RETURNING id::text, name
    `;

    if (defaultModel) {
      await sql`
        INSERT INTO provider_models (provider_id, model_name, display_name)
        VALUES (${provider.id}::uuid, ${defaultModel}, ${defaultModel})
        ON CONFLICT (provider_id, model_name) DO NOTHING
      `;
    }

    return NextResponse.json(
      { id: provider.id, name: provider.name },
      { status: 201 },
    );
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code === "23505") {
      return NextResponse.json(
        { detail: "Provider already exists" },
        { status: 409 },
      );
    }
    console.error("[conflux] provider create failed:", error);
    return NextResponse.json(
      { detail: "Failed to create provider" },
      { status: 500 },
    );
  }
}
