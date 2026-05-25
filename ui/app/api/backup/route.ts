export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";

const API_BASE =
  process.env.INTERNAL_API_BASE ??
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://conflux-api:8001";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

async function readUpstreamError(response: Response, fallback: string) {
  const text = await response.text().catch(() => "");
  if (!text) {
    return fallback;
  }

  try {
    const data = JSON.parse(text) as {
      detail?: string;
      error?: string;
      message?: string;
    };
    return data.detail ?? data.error ?? data.message ?? fallback;
  } catch {
    return text;
  }
}

export async function GET() {
  const session = await auth();
  const azureOid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!azureOid || !email || !INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByOid(azureOid, email).catch(() => null);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const upstream = await fetch(`${API_BASE}/v1/backup`, {
    headers: {
      "X-Internal-Secret": INTERNAL_SECRET,
      "X-User-Email": email,
    },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: await readUpstreamError(upstream, "Backup failed") },
      { status: upstream.status },
    );
  }

  const contentDisposition =
    upstream.headers.get("Content-Disposition") ??
    `attachment; filename="conflux-backup-${new Date().toISOString().slice(0, 10)}.json"`;
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  const contentLength = upstream.headers.get("Content-Length");

  if (!upstream.body) {
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition,
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": contentDisposition,
      "Content-Type": contentType,
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
  });
}
