export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

async function getSessionEmail(_req: NextRequest): Promise<string | null> {
  return requireAdminEmail();
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${BACKEND}/v1/admin/view-as-user`, {
    method: "POST",
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}

export async function DELETE(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${BACKEND}/v1/admin/view-as-user`, {
    method: "DELETE",
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}
