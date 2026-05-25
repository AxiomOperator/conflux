export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const params = url.searchParams.toString();
  const resource = url.searchParams.get("resource") || "patterns";
  const cleanParams = new URLSearchParams(params);
  cleanParams.delete("resource");
  const cleanStr = cleanParams.toString();
  const response = await fetch(
    `${BACKEND}/v1/admin/improvement/${encodeURIComponent(resource)}${cleanStr ? `?${cleanStr}` : ""}`,
    { headers: adminHeaders(email), cache: "no-store" },
  );
  return proxyJsonResponse(response);
}

export async function POST(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "run-cycle";
  const body = await request.text();
  const response = await fetch(
    `${BACKEND}/v1/admin/improvement/${encodeURIComponent(resource)}`,
    {
      method: "POST",
      headers: {
        ...adminHeaders(email),
        "Content-Type": "application/json",
      },
      body,
    },
  );
  return proxyJsonResponse(response);
}
