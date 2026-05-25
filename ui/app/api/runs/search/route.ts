export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { createServerApiClient } from "@/lib/server-api";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (!query) {
    return NextResponse.json([]);
  }

  const client = await createServerApiClient();
  const data = await client.runs.search(query);
  return NextResponse.json(data);
}
