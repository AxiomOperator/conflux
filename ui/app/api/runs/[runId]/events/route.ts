export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/runs/${runId}/events`, {
    headers: {
      "X-Internal-Secret": INTERNAL_API_SECRET,
      "X-User-Email": email,
    },
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({ detail: `Upstream error: ${res.status}` }, { status: res.status });
  }

  return NextResponse.json(data, { status: res.status });
}
