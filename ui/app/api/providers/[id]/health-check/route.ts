export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

type ProviderRow = {
  base_url: string;
  health_status: string;
  id: string;
  name: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function checkEndpoint(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { detail: "Invalid provider id" },
      { status: 400 },
    );
  }

  const sql = getDb();
  const [provider] = await sql<ProviderRow[]>`
    SELECT id::text, name, base_url, health_status
    FROM providers
    WHERE id = ${id}::uuid
  `;

  if (!provider) {
    return NextResponse.json({ detail: "Provider not found" }, { status: 404 });
  }

  const baseUrl = String(provider.base_url).replace(/\/+$/, "");
  let healthy = await checkEndpoint(`${baseUrl}/models`);
  if (!healthy) {
    healthy = await checkEndpoint(`${baseUrl}/health`);
  }

  const newStatus = healthy ? "healthy" : "unhealthy";
  await sql`
    UPDATE providers
    SET health_status = ${newStatus}, last_health_check_at = NOW(), updated_at = NOW()
    WHERE id = ${id}::uuid
  `;

  return NextResponse.json({ healthy });
}
