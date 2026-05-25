export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  INTERNAL_API_SECRET,
  proxyWikiResponse,
  requireWikiEmail,
  WIKI_BACKEND,
  wikiHeaders,
} from "@/app/api/wiki/_proxy";

export async function GET() {
  const email = await requireWikiEmail();
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${WIKI_BACKEND}/v1/wiki/spaces`, {
    cache: "no-store",
    headers: wikiHeaders(email),
  });
  return proxyWikiResponse(response);
}
