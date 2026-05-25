export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";

import {
  INTERNAL_API_SECRET,
  proxyWikiResponse,
  requireWikiEmail,
  WIKI_BACKEND,
  wikiHeaders,
  withSearchParams,
} from "@/app/api/wiki/_proxy";

export async function GET(request: NextRequest) {
  const email = await requireWikiEmail();
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(
    withSearchParams(request, `${WIKI_BACKEND}/v1/wiki/search`),
    {
      cache: "no-store",
      headers: wikiHeaders(email),
    },
  );
  return proxyWikiResponse(response);
}
