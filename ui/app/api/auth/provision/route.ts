export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { provisionSsoUser } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: azure_oid, email, name } = session.user;

  if (!azure_oid || !email) {
    return NextResponse.json({ error: "Missing profile data" }, { status: 400 });
  }

  try {
    await provisionSsoUser({
      azure_oid,
      email,
      display_name: name ?? email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[conflux] provision failed:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
