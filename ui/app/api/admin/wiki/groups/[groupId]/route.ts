export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

type Params = { params: Promise<{ groupId: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId } = await params;
  const response = await fetch(
    `${BACKEND}/v1/admin/wiki/groups/${encodeURIComponent(groupId)}`,
    {
      method: "DELETE",
      headers: adminHeaders(email),
    },
  );

  return proxyJsonResponse(response);
}
