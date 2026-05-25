export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function internalAuthHeaders(email: string): Record<string, string> {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") ?? "10";

  const res = await fetch(
    `${INTERNAL_API_URL}/v1/runs?limit=${limit}`,
    {
      headers: internalAuthHeaders(email),
      cache: "no-store",
    },
  );

  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalAuthHeaders(email),
    },
    body: JSON.stringify(body),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      { detail: `Upstream error: ${res.status}` },
      { status: res.status },
    );
  }

  return NextResponse.json(data, { status: res.status });
}
