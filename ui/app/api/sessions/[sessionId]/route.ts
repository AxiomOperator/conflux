export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function internalHeaders(email: string): Record<string, string> {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
  };
}

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { sessionId } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET)
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${INTERNAL_API_URL}/v1/sessions/${sessionId}`, {
    headers: internalHeaders(email),
  });
  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET)
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${INTERNAL_API_URL}/v1/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...internalHeaders(email) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { sessionId } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !INTERNAL_API_SECRET)
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${INTERNAL_API_URL}/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: internalHeaders(email),
  });
  if (res.status === 204) return new Response(null, { status: 204 });
  const data = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
  return NextResponse.json(data, { status: res.status });
}
