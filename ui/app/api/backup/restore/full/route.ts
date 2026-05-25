export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getUserByOid } from "@/lib/db";

const API_BASE =
  process.env.INTERNAL_API_BASE ??
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://conflux-api:8001";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function parseUpstreamPayload(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function POST(request: NextRequest) {
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

  const incomingForm = await request.formData();
  const file = incomingForm.get("file");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const upstreamForm = new FormData();
  const filename = file instanceof File && file.name ? file.name : "conflux-full-backup.zip";
  upstreamForm.append("file", file, filename);

  const upstream = await fetch(`${API_BASE}/v1/backup/restore/full`, {
    method: "POST",
    headers: {
      "X-Internal-Secret": INTERNAL_SECRET,
      "X-User-Email": email,
    },
    body: upstreamForm,
  });

  const payload = parseUpstreamPayload(await upstream.text().catch(() => ""));
  return NextResponse.json(payload, { status: upstream.status });
}
