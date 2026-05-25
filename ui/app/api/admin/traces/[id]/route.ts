export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const response = await fetch(
    `${BACKEND}/v1/admin/traces/${encodeURIComponent(id)}`,
    { headers: adminHeaders(email), cache: "no-store" },
  );
  return proxyJsonResponse(response);
}
