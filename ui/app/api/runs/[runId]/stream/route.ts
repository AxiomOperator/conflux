export const runtime = "nodejs";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(
    `${INTERNAL_API_URL}/v1/runs/${runId}/stream`,
    {
      headers: {
        "X-Internal-Secret": INTERNAL_API_SECRET,
        "X-User-Email": email,
      },
    },
  ).catch((err: unknown) => {
    throw new Error(
      `Failed to connect to upstream: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error: ${upstream.status}`, {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
