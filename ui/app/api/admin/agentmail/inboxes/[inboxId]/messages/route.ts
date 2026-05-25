export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
  withSearchParams,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ inboxId: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { inboxId } = await params;
  const response = await fetch(
    withSearchParams(
      request,
      `${BACKEND}/v1/admin/agentmail/inboxes/${encodeURIComponent(inboxId)}/messages`,
    ),
    {
      headers: adminHeaders(email),
      cache: "no-store",
    },
  );

  return proxyJsonResponse(response);
}
