export const runtime = "nodejs";

import { NextResponse } from "next/server";

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

  const response = await fetch(`${BACKEND}/v1/admin/settings`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}
