import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const BACKEND = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

function adminHeaders(email: string, extra: Record<string, string> = {}) {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
    ...extra,
  };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const res = await fetch(`${BACKEND}/v1/admin/sso/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders(email),
  });

  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${BACKEND}/v1/admin/sso/users/${id}`, {
    method: "PUT",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
