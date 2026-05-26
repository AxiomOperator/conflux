export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { BACKEND, adminHeaders, proxyJsonResponse, requireAdminEmail } from "../_proxy";

export async function GET() {
  const email = await requireAdminEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${BACKEND}/v1/discord/status`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });
  return proxyJsonResponse(res);
}
