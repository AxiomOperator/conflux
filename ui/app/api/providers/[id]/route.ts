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
