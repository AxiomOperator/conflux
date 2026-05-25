export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  const body = await request.json().catch(() => ({}));
  const response = await fetch(
    `${BACKEND}/v1/admin/settings/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: adminHeaders(email, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
  );

  return proxyJsonResponse(response);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  const response = await fetch(
    `${BACKEND}/v1/admin/settings/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers: adminHeaders(email),
    },
  );

  return proxyJsonResponse(response);
}
