export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";

type OAIModel = { id: string };
type OAIModelsResponse = { data?: OAIModel[] };

export async function GET(request: Request) {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!azure_oid) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getUserByOid(azure_oid, email).catch(() => null);
  if (!dbUser?.is_admin) {
    return NextResponse.json({ detail: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get("base_url")?.trim().replace(/\/+$/, "");

  if (!baseUrl) {
    return NextResponse.json({ detail: "base_url is required" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { detail: `Provider returned HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const json = (await res.json()) as OAIModelsResponse;
    const models: string[] = (json.data ?? [])
      .map((m) => m.id)
      .filter(Boolean)
      .sort();

    return NextResponse.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    return NextResponse.json(
      { detail: isTimeout ? "Connection timed out" : `Could not reach provider: ${msg}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
