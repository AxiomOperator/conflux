export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function internalAuthHeaders(email: string): Record<string, string> {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
  };
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/personality`, {
    headers: {
      "Content-Type": "application/json",
      ...internalAuthHeaders(email),
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${INTERNAL_API_URL}/v1/personality`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalAuthHeaders(email),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}
