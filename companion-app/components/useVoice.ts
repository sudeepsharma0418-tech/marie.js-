"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice uses the speech features built into the browser: no keys, no cost.
// Listening works in Chrome, Edge and Safari. Speaking works in all modern browsers.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Turns chat text into something pleasant to hear. */
function speakable(text: string) {
  return text
    .replace(/[*_`#>]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A stable small number from a name, so each companion keeps the same voice. */
function seed(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Optional speaking style: pace and tone only. It never imitates a real person's voice. */
export type VoiceStyle = { rate?: number; pitch?: number };

export function useVoice(companionName: string, style?: VoiceStyle) {
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setCanListen(Boolean(recognitionClass()));
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
    // Some browsers load voices a moment later.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => {
      rec.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (text: string, id: string) => {
      if (!("speechSynthesis" in window)) return;
      const clean = speakable(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      const lang = (navigator.language || "en").slice(0, 2);
      const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
      const pool = voices.length ? voices : window.speechSynthesis.getVoices();
      const s = seed(companionName);
      if (pool.length) u.voice = pool[s % pool.length];
      u.rate = style?.rate ?? 1;
      u.pitch = style?.pitch ?? 0.9 + (s % 5) * 0.05; // a slightly different tone per companion
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
      setSpeakingId(id);
      window.speechSynthesis.speak(u);
    },
    [companionName, style?.rate, style?.pitch],
  );

  /** Listens once. Calls onText while speaking and onDone with the final words. */
  const listen = useCallback((onText: (t: string) => void, onDone: (t: string) => void) => {
    const Cls = recognitionClass();
    if (!Cls) return;
    setError("");
    stopSpeaking();
    const r = new Cls();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText = res[0].transcript;
        else interim += res[0].transcript;
      }
      onText((finalText || interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access was blocked. Allow it in your browser settings.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("Couldn't hear that. Please try again.");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (finalText.trim()) onDone(finalText.trim());
    };
    rec.current = r;
    setListening(true);
    r.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => rec.current?.stop(), []);

  return { canListen, canSpeak, listening, speakingId, error, speak, stopSpeaking, listen, stopListening };
}
