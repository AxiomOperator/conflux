export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
  withSearchParams,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(
    withSearchParams(request, `${BACKEND}/v1/admin/agentmail/inboxes`),
    {
      headers: adminHeaders(email),
      cache: "no-store",
    },
  );

  return proxyJsonResponse(response);
}

export async function POST(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${BACKEND}/v1/admin/agentmail/inboxes`, {
    method: "POST",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  return proxyJsonResponse(response);
}
