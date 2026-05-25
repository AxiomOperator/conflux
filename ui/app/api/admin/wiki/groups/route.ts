export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET() {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${BACKEND}/v1/admin/wiki/groups`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}

export async function POST(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const response = await fetch(`${BACKEND}/v1/admin/wiki/groups`, {
    method: "POST",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  return proxyJsonResponse(response);
}
