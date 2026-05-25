export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  adminHeaders,
  BACKEND,
  proxyJsonResponse,
  requireAdminEmail,
} from "@/app/api/admin/agentmail/_proxy";

type Params = { params: Promise<{ id: string }> };

function buildTarget(resource: string, id: string, action?: string | null) {
  const base = `${BACKEND}/v1/admin/improvement/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`;
  return action ? `${base}/${encodeURIComponent(action)}` : base;
}

export async function GET(request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "patterns";
  const { id } = await params;
  const response = await fetch(buildTarget(resource, id), {
    headers: adminHeaders(email),
    cache: "no-store",
  });

  return proxyJsonResponse(response);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "patterns";
  const action = url.searchParams.get("action");
  const { id } = await params;
  const body = await request.text();
  const response = await fetch(buildTarget(resource, id, action), {
    method: "PATCH",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body,
  });

  return proxyJsonResponse(response);
}

export async function POST(request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "candidates";
  const action = url.searchParams.get("action");
  const { id } = await params;
  const body = await request.text();
  const response = await fetch(buildTarget(resource, id, action), {
    method: "POST",
    headers: adminHeaders(email, { "Content-Type": "application/json" }),
    body,
  });

  return proxyJsonResponse(response);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const email = await requireAdminEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "eval-cases";
  const { id } = await params;
  const response = await fetch(buildTarget(resource, id), {
    method: "DELETE",
    headers: adminHeaders(email),
  });

  return proxyJsonResponse(response);
}
