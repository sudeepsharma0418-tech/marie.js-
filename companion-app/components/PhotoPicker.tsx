"use client";

import { useRef, useState } from "react";

/** Shrinks an image in the browser so uploads stay small and fast. */
async function shrink(file: File, max: number, quality: number) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't read that photo.");
  return { blob, w, h };
}

/**
 * Pick a photo, shrink it, upload it, and put its id in a hidden form field.
 * `round` shows a circular preview (for companion pictures).
 */
export default function PhotoPicker({
  name = "photoId",
  initialId,
  round,
  label = "Add a photo",
}: {
  name?: string;
  initialId?: string | null;
  round?: boolean;
  label?: string;
}) {
  const [id, setId] = useState(initialId ?? "");
  const [preview, setPreview] = useState(initialId ? `/api/photos/${initialId}?size=thumb` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const full = await shrink(file, 1600, 0.84);
      const thumb = await shrink(file, 520, 0.8);
      const form = new FormData();
      form.set("full", new File([full.blob], "photo.jpg", { type: "image/jpeg" }));
      form.set("thumb", new File([thumb.blob], "thumb.jpg", { type: "image/jpeg" }));
      form.set("width", String(full.w));
      form.set("height", String(full.h));
      const res = await fetch("/api/photos", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setId(data.id);
      setPreview(URL.createObjectURL(thumb.blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={`photo-picker ${round ? "round" : ""}`}>
      <input type="hidden" name={name} value={id} />
      <input ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => onPick(e.target.files?.[0])} />
      <button type="button" className="photo-drop" onClick={() => input.current?.click()} disabled={busy} aria-label={preview ? "Change photo" : label}>
        {preview ? <img src={preview} alt="" /> : <span className="muted small">{busy ? "Uploading..." : label}</span>}
        {busy && preview && <span className="photo-busy">Uploading...</span>}
      </button>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn outline sm" onClick={() => input.current?.click()} disabled={busy}>
          {preview ? "Change" : "Choose photo"}
        </button>
        {preview && !busy && (
          <button type="button" className="btn quiet sm" onClick={() => { setId(""); setPreview(""); }}>Remove</button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
