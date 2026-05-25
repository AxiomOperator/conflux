export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ inboxId: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { inboxId } = await params;
  const response = await fetch(
    `${BACKEND}/v1/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}`,
    {
      method: "DELETE",
      headers: adminHeaders(email),
    },
  );

  return proxyJsonResponse(response);
}
