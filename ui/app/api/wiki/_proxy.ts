import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export const WIKI_BACKEND =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
export const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function requireWikiEmail() {
  const session = await auth();
  return session?.user?.email ?? null;
}

export function wikiHeaders(
  email: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
    ...extra,
  };
}

export function withSearchParams(request: NextRequest, url: string) {
  const query = request.nextUrl.searchParams.toString();
  return query ? `${url}?${query}` : url;
}

export async function proxyWikiResponse(response: Response) {
  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response
    .json()
    .catch(() => ({ detail: `Error ${response.status}` }));
  return NextResponse.json(data, { status: response.status });
}
