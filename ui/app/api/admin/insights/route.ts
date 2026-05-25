export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  BACKEND,
  adminHeaders,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET() {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${BACKEND}/v1/admin/insights`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}
