export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { BACKEND, adminHeaders, requireAdminEmail } from "@/app/api/admin/agentmail/_proxy";

export async function GET() {
  const email = await requireAdminEmail();

  if (!email || !process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${BACKEND}/v1/doctor`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);
  return NextResponse.json(
    data ?? { overall: "error", checks: [] },
    { status: res.ok ? 200 : res.status },
  );
}
