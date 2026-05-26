export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { BACKEND, adminHeaders, proxyJsonResponse, requireAdminEmail } from "../../_proxy";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { guildId } = await params;
  const res = await fetch(`${BACKEND}/v1/discord/guilds/${guildId}`, {
    headers: adminHeaders(email),
    cache: "no-store",
  });
  return proxyJsonResponse(res);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { guildId } = await params;
  const body = await req.json();
  const res = await fetch(`${BACKEND}/v1/discord/guilds/${guildId}`, {
    method: "PUT",
    headers: { ...adminHeaders(email), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return proxyJsonResponse(res);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const email = await requireAdminEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { guildId } = await params;
  const res = await fetch(`${BACKEND}/v1/discord/guilds/${guildId}`, {
    method: "DELETE",
    headers: adminHeaders(email),
  });
  return proxyJsonResponse(res);
}
