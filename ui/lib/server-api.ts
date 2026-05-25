/**
 * Server-only API helpers.
 * This file imports from auth.ts (which pulls in db.ts / postgres).
 * It must NEVER be imported by client components — only by Server Components
 * and Route Handlers.
 */
import { auth } from "@/lib/auth";
import { createApiClient } from "@/lib/api";
import type { ApiRequestOptions } from "@/lib/api";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function getServerAccessToken() {
  const session = await auth();
  return session?.accessToken ?? session?.idToken;
}

export async function getServerAuthOptions(): Promise<
  Pick<ApiRequestOptions, "internalSecret" | "internalEmail">
> {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (INTERNAL_API_SECRET && email) {
    return { internalSecret: INTERNAL_API_SECRET, internalEmail: email };
  }
  return { internalSecret: undefined, internalEmail: undefined };
}

export async function createServerApiClient() {
  const { internalSecret, internalEmail } = await getServerAuthOptions();
  if (internalSecret && internalEmail) {
    return createApiClient(undefined, true, { internalSecret, internalEmail });
  }
  const token = await getServerAccessToken();
  return createApiClient(token, true);
}
