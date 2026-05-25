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

  const response = await fetch(`${INTERNAL_API_URL}/v1/onboarding/status`, {
    headers: {
      "Content-Type": "application/json",
      ...internalAuthHeaders(email),
    },
    cache: "no-store",
  });

  const data = await response
    .json()
    .catch(() => ({ detail: `Error ${response.status}` }));
  return NextResponse.json(data, { status: response.status });
}
