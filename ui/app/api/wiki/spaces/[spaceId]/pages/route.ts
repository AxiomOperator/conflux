export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  INTERNAL_API_SECRET,
  proxyWikiResponse,
  requireWikiEmail,
  WIKI_BACKEND,
  wikiHeaders,
} from "@/app/api/wiki/_proxy";

type Params = { params: Promise<{ spaceId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const email = await requireWikiEmail();
  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { spaceId } = await params;
  const response = await fetch(
    `${WIKI_BACKEND}/v1/wiki/spaces/${spaceId}/pages`,
    {
      cache: "no-store",
      headers: wikiHeaders(email),
    },
  );
  return proxyWikiResponse(response);
}
