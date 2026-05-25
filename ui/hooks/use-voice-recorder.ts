"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing" | "error";

interface UseVoiceRecorderOptions {
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceRecorder({
  onTranscript,
  onError,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    setState("transcribing");

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    // Stop the mic stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");

      const res = await fetch("/api/transcribe", {
        body: form,
        method: "POST",
      });

      const data = (await res.json()) as { text?: string; error?: string };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Transcription failed");
      }

      if (data.text?.trim()) {
        onTranscript(data.text.trim());
      }
      setState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setState("error");
      onError?.(msg);
      setTimeout(() => setState("idle"), 2000);
    }
  }, [onTranscript, onError]);

  const start = useCallback(async () => {
    if (state !== "idle") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start(250);
      setState("recording");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Microphone access denied";
      setState("error");
      onError?.(msg);
      setTimeout(() => setState("idle"), 2000);
    }
  }, [state, onError]);

  const toggle = useCallback(() => {
    if (state === "recording") {
      void stop();
    } else if (state === "idle") {
      void start();
    }
  }, [state, start, stop]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { start, state, stop, toggle };
}
