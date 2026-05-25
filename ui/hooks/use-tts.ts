"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TtsState = "idle" | "speaking" | "error";

export interface TtsVoice {
  id: string;
  name: string;
  gender: string;
  locale: string;
}

interface UseTtsOptions {
  /** Initial voice ID (edge-tts voice). Defaults to en-US-AvaNeural. */
  voiceId?: string;
  /** Speech rate adjustment, e.g. "+10%" or "-5%". Defaults to "+0%". */
  rate?: string;
}

/** Strip markdown-ish syntax before speaking. */
function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#+\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
}

export function useTts(opts: UseTtsOptions = {}) {
  const { voiceId = "en-US-AvaNeural", rate = "+0%" } = opts;
  const [state, setState] = useState<TtsState>("idle");
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(voiceId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Fetch available voices from the backend
  useEffect(() => {
    fetch("/api/tts/voices")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (Array.isArray(data)) setVoices(data); })
      .catch(() => { /* silently ignore — voices list is non-critical */ });
  }, []);

  const _revokeUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    _revokeUrl();
    setState("idle");
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const cleaned = cleanText(text);
      if (!cleaned) return;

      // Stop any current playback
      stop();

      setState("speaking");
      try {
        const res = await fetch("/api/tts/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: cleaned, voice: selectedVoice, rate }),
        });

        if (!res.ok) {
          throw new Error(`TTS request failed: ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { _revokeUrl(); setState("idle"); };
        audio.onerror = () => { _revokeUrl(); setState("idle"); };
        await audio.play();
      } catch {
        setState("idle");
      }
    },
    [stop, selectedVoice, rate],
  );

  const toggle = useCallback(
    (text: string) => {
      if (state === "speaking") {
        stop();
      } else {
        speak(text);
      }
    },
    [state, speak, stop],
  );

  // Stop on unmount
  useEffect(() => {
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    speak,
    stop,
    toggle,
    voices,
    selectedVoice,
    setSelectedVoice,
    supported: true,
  };
}

