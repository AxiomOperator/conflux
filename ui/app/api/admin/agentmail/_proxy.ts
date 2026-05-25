import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export const BACKEND =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export function adminHeaders(
  email: string,
  extra: Record<string, string> = {},
) {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
    ...extra,
  };
}

export async function requireAdminEmail() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return null;
  }
  return email;
}

export function withSearchParams(request: NextRequest, url: string) {
  const query = request.nextUrl.searchParams.toString();
  return query ? `${url}?${query}` : url;
}

export async function proxyJsonResponse(response: Response) {
  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
