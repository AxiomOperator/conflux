export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

export async function GET(request: NextRequest) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const params = url.searchParams.toString();
  const response = await fetch(
    `${BACKEND}/v1/admin/traces${params ? `?${params}` : ""}`,
    { headers: adminHeaders(email), cache: "no-store" },
  );
  return proxyJsonResponse(response);
}
