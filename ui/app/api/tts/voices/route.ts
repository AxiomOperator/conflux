export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_API_URL}/v1/tts/voices`, {
    headers: {
      "X-Internal-Secret": INTERNAL_API_SECRET,
      "X-User-Email": email,
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch voices" }, { status: res.status });
  }

  const voices = await res.json();
  return NextResponse.json(voices);
}
