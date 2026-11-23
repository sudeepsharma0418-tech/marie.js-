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

// Novelty voices that ship with some systems (mostly Apple). Never use these.
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|kathy|grandma|grandpa|rocko|shelley|flo|eddy|reed|sandy/i;
// Voices that usually sound the most natural.
const QUALITY = /natural|neural|enhanced|premium|google|samantha|daniel|alex|aria|jenny|guy|libby|ryan|siri/i;

/** Picks a good voice in the person's language. Companions get one of the best few. */
function pickVoice(s: number) {
  const all = window.speechSynthesis.getVoices();
  if (!all.length) return null;
  const lang = (navigator.language || "en-US").toLowerCase();
  const base = lang.slice(0, 2);
  const usable = all.filter((v) => !NOVELTY.test(v.name));
  const sameLang = usable.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = sameLang.length ? sameLang : usable;
  const rank = (v: SpeechSynthesisVoice) =>
    (QUALITY.test(v.name) ? 0 : 2) + (v.lang.toLowerCase() === lang ? 0 : 1) + (v.default ? -0.5 : 0);
  const best = [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  return best.length ? best[s % best.length] : null;
}

// A tiny silent sound, used to unlock audio playback on Safari.
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/** Plays a short sample of a voice style, for previews in the companion form. */
export function previewVoice(text: string, seedName: string, style?: VoiceStyle) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  try {
    const voice = pickVoice(seed(seedName));
    if (voice) u.voice = voice;
  } catch {}
  u.rate = style?.rate ?? 1;
  u.pitch = style?.pitch ?? 1;
  window.speechSynthesis.speak(u);
  return true;
}

/**
 * companionName and style shape the device voice. If cloneFor is a companion id,
 * replies play in that companion's uploaded voice instead (falls back to the device voice).
 */
export function useVoice(companionName: string, style?: VoiceStyle, cloneFor?: string) {
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioCtl = useRef<AbortController | null>(null);
  const unlocked = useRef(false);

  // Safari only lets a page play audio that was started from a tap. Playing a
  // silent clip during a tap unlocks this audio element for later replies.
  const prime = useCallback(() => {
    if (!cloneFor || unlocked.current || typeof Audio === "undefined") return;
    const a = audio.current ?? new Audio();
    audio.current = a;
    a.src = SILENT;
    a.play().then(() => { unlocked.current = true; }).catch(() => {});
  }, [cloneFor]);

  useEffect(() => {
    setCanListen(Boolean(recognitionClass()));
    setCanSpeak(Boolean(cloneFor) || (typeof window !== "undefined" && "speechSynthesis" in window));
    // Some browsers load voices a moment later.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => {
      rec.current?.stop();
      audioCtl.current?.abort();
      audio.current?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    audioCtl.current?.abort();
    audio.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  const speakDevice = useCallback(
    (text: string, id: string) => {
      if (!("speechSynthesis" in window)) return setSpeakingId(null);
      const clean = speakable(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      const s = seed(companionName);
      try {
        const voice = pickVoice(s);
        if (voice) u.voice = voice;
      } catch {
        // Fall back to the device's default voice.
      }
      u.rate = style?.rate ?? 1;
      u.pitch = style?.pitch ?? 0.95 + (s % 3) * 0.05; // a slightly different tone per companion
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
      setSpeakingId(id);
      window.speechSynthesis.speak(u);
    },
    [companionName, style?.rate, style?.pitch],
  );

  const speak = useCallback(
    (text: string, id: string) => {
      if (!cloneFor) return speakDevice(text, id);
      const clean = speakable(text);
      if (!clean) return;
      audioCtl.current?.abort();
      audio.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      prime();
      setError("");
      const ctl = new AbortController();
      audioCtl.current = ctl;
      setSpeakingId(id);
      const finish = () => setSpeakingId((cur) => (cur === id ? null : cur));
      fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companionId: cloneFor, text: clean }),
        signal: ctl.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Couldn't play the uploaded voice.");
          }
          const url = URL.createObjectURL(await res.blob());
          if (ctl.signal.aborted) return URL.revokeObjectURL(url);
          const a = audio.current ?? new Audio();
          audio.current = a;
          a.onended = a.onerror = () => { URL.revokeObjectURL(url); finish(); };
          a.src = url;
          await a.play();
        })
        .catch((e: Error) => {
          if (ctl.signal.aborted) return;
          finish();
          if (e.name === "NotAllowedError") setError("Your browser blocked the sound. Tap the play button on the message to hear it.");
          else {
            setError(`${e.message} Using the device voice instead.`);
            speakDevice(text, id);
          }
        });
    },
    [cloneFor, speakDevice, prime],
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

  return { canListen, canSpeak, listening, speakingId, error, speak, stopSpeaking, listen, stopListening, prime };
}
