export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

type Params = { params: Promise<{ spaceId: string }> };

function internalHeaders(email: string) {
  return {
    "X-Internal-Secret": INTERNAL_API_SECRET,
    "X-User-Email": email,
  };
}

function parseResponseBody(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

function toJsonResponse(response: Response, text: string) {
  if (response.status === 204) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json(parseResponseBody(text), {
    status: response.status,
  });
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !INTERNAL_API_SECRET) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const incomingForm = await request.formData();
  const file = incomingForm.get("file");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ detail: "File is required" }, { status: 400 });
  }

  const upstreamForm = new FormData();
  const filename = file instanceof File && file.name ? file.name : "upload";
  upstreamForm.append("file", file, filename);

  const { spaceId } = await params;
  const response = await fetch(
    `${INTERNAL_API_URL}/v1/wiki/spaces/${spaceId}/upload`,
    {
      method: "POST",
      headers: internalHeaders(email),
      body: upstreamForm,
    },
  );

  return toJsonResponse(response, await response.text());
}
