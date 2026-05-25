export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

type Params = { params: Promise<{ spaceId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { spaceId } = await params;
  const response = await fetch(
    `${BACKEND}/v1/admin/wiki/spaces/${encodeURIComponent(spaceId)}/rules`,
    {
      headers: adminHeaders(email),
      cache: "no-store",
    },
  );

  return proxyJsonResponse(response);
}

export async function POST(request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { spaceId } = await params;
  const body = await request.json();
  const response = await fetch(
    `${BACKEND}/v1/admin/wiki/spaces/${encodeURIComponent(spaceId)}/rules`,
    {
      method: "POST",
      headers: adminHeaders(email, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
  );

  return proxyJsonResponse(response);
}
