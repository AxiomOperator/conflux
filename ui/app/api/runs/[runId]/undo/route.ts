export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function internalHeaders(email: string): Record<string, string> {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
  };
}

type Params = { params: Promise<{ runId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { runId } = await params;
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/runs/${runId}/undo`, {
    method: "POST",
    headers: internalHeaders(email),
  });
  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}
