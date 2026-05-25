import { NextRequest, NextResponse } from "next/server";

const WHISPER_BASE_URL =
  process.env.WHISPER_BASE_URL ?? "http://localhost:8000";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? "Systran/faster-whisper-base";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 },
      );
    }

    const upstream = new FormData();
    upstream.append("file", audioFile, "recording.webm");
    upstream.append("model", WHISPER_MODEL);
    upstream.append("response_format", "json");
    upstream.append("language", "en");

    const response = await fetch(`${WHISPER_BASE_URL}/v1/audio/transcriptions`, {
      body: upstream,
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Whisper error: ${text}` },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { text?: string };
    return NextResponse.json({ text: data.text ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
