"use client";

import { useRef, useState } from "react";

/**
 * Upload a recording to give a companion a real voice. The person must confirm
 * it is their voice or that they have the speaker's permission.
 */
export default function VoiceUpload({
  enabled,
  companionName,
  initial,
}: {
  enabled: boolean;
  companionName: string;
  initial?: { fileName: string } | null;
}) {
  // "keep" leaves an existing voice as it is; "" means none; otherwise a new upload's id.
  const [value, setValue] = useState(initial ? "keep" : "");
  const [fileName, setFileName] = useState(initial?.fileName ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 4 * 1024 * 1024) {
      setError("That file is too big. Use a clip under 4 MB (about 2 minutes of mp3).");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("consent", "yes");
      form.set("name", companionName);
      const res = await fetch("/api/voice", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setValue(data.id);
      setFileName(data.fileName || file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const hasVoice = value !== "";

  return (
    <div className="voice-upload">
      <input type="hidden" name="voiceCloneId" value={value} />
      <strong className="small">Use a real voice</strong>
      {!enabled ? (
        <span className="hint">Voice upload isn&apos;t turned on for this site yet.</span>
      ) : hasVoice ? (
        <div className="row between wrap" style={{ gap: 8 }}>
          <span className="small">🎙️ {fileName || "Uploaded voice"} <span className="hint">· replies will be spoken in this voice</span></span>
          <button type="button" className="btn quiet sm" onClick={() => { setValue(""); setFileName(""); }}>Remove</button>
        </div>
      ) : (
        <>
          <span className="hint">
            Upload an mp3 or voice memo of {companionName || "them"} talking. 1 to 2 minutes of clear speech, no music, under 4 MB.
          </span>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="small">
              This is my own voice, or a family member or friend whose voice I have the right to use (with their permission, or their family&apos;s if they have passed away). No celebrities or public figures.
            </span>
          </label>
          <input ref={input} type="file" accept="audio/*,.mp3,.m4a,.wav" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" className="btn outline sm" style={{ alignSelf: "flex-start" }} disabled={!consent || busy} onClick={() => input.current?.click()}>
            {busy ? "Making the voice..." : "Upload recording"}
          </button>
        </>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}
