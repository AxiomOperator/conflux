export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  INTERNAL_API_SECRET,
  proxyWikiResponse,
  requireWikiEmail,
  WIKI_BACKEND,
  wikiHeaders,
} from "@/app/api/wiki/_proxy";

type Params = { params: Promise<{ pageId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const email = await requireWikiEmail();
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { pageId } = await params;
  const response = await fetch(`${WIKI_BACKEND}/v1/wiki/pages/${pageId}`, {
    cache: "no-store",
    headers: wikiHeaders(email),
  });
  return proxyWikiResponse(response);
}

export async function DELETE(_request: Request, { params }: Params) {
  const email = await requireWikiEmail();
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { pageId } = await params;
  const response = await fetch(`${WIKI_BACKEND}/v1/wiki/pages/${pageId}`, {
    method: "DELETE",
    headers: wikiHeaders(email),
  });
  return proxyWikiResponse(response);
}
