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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const { keyId } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/users/me/api-keys/${keyId}`, {
    method: "DELETE",
    headers: { ...internalAuthHeaders(email) },
  });

  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({ detail: "Upstream error" }, { status: res.status });
  }
  return NextResponse.json(data, { status: res.status });
}
