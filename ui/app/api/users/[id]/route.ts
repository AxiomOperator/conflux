export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDb, getUserByOid } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UserUpdateBody = {
  is_admin?: boolean;
  is_active?: boolean;
};

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
    return NextResponse.json({ detail: "Invalid user id" }, { status: 400 });
  }

  let body: UserUpdateBody;
  try {
    body = (await request.json()) as UserUpdateBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const sql = getDb();

  if (
    typeof body.is_admin === "boolean" &&
    typeof body.is_active === "boolean"
  ) {
    await sql`
      UPDATE users
      SET is_admin = ${body.is_admin}, is_active = ${body.is_active}, updated_at = NOW()
      WHERE id = ${id}::uuid
    `;
  } else if (typeof body.is_admin === "boolean") {
    await sql`
      UPDATE users SET is_admin = ${body.is_admin}, updated_at = NOW() WHERE id = ${id}::uuid
    `;
  } else if (typeof body.is_active === "boolean") {
    await sql`
      UPDATE users SET is_active = ${body.is_active}, updated_at = NOW() WHERE id = ${id}::uuid
    `;
  } else {
    return NextResponse.json({ detail: "No fields to update" }, { status: 400 });
  }

  return NextResponse.json({ id, updated: true });
}
