export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDb, getUserByOid } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!azure_oid) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getUserByOid(azure_oid, email).catch(() => null);
  if (!dbUser?.is_admin) {
    return NextResponse.json(
      { detail: "Admin access required" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ detail: "Invalid provider id" }, { status: 400 });
  }

  const sql = getDb();

  await sql`DELETE FROM provider_models WHERE provider_id = ${id}::uuid`;

  const deleted = await sql<{ id: string }[]>`
    DELETE FROM providers WHERE id = ${id}::uuid RETURNING id::text
  `;

  if (!deleted.length) {
    return NextResponse.json({ detail: "Provider not found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const azure_oid = session?.user?.id;
  const email = session?.user?.email ?? undefined;

  if (!azure_oid) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getUserByOid(azure_oid, email).catch(() => null);
  if (!dbUser?.is_admin) {
    return NextResponse.json(
      { detail: "Admin access required" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ detail: "Invalid provider id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    base_url?: string;
    api_key?: string;
    is_enabled?: boolean;
  };

  const sql = getDb();

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.base_url !== undefined) {
    setClauses.push(`base_url = $${idx++}`);
    values.push(body.base_url);
  }
  if (body.api_key !== undefined) {
    setClauses.push(`api_key = $${idx++}`);
    values.push(body.api_key);
  }
  if (body.is_enabled !== undefined) {
    setClauses.push(`is_enabled = $${idx++}`);
    values.push(body.is_enabled);
  }

  if (!setClauses.length) {
    return NextResponse.json({ detail: "Nothing to update" }, { status: 400 });
  }

  values.push(id);
  const query = `UPDATE providers SET ${setClauses.join(", ")} WHERE id = $${idx}::uuid RETURNING id::text, name, base_url, is_enabled`;

  const rows = await sql.unsafe(query, values as never[]) as { id: string; name: string; base_url: string; is_enabled: boolean }[];

  if (!rows.length) {
    return NextResponse.json({ detail: "Provider not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
