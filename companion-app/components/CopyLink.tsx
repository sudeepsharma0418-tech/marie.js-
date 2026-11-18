"use client";

import { useState } from "react";
import { ShareIcon } from "./Icons";

export default function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn outline lg"
      onClick={async () => {
        const url = `${window.location.origin}${path}`;
        try {
          if (navigator.share) await navigator.share({ url });
          else await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {}
      }}
    >
      <ShareIcon className="" /> {copied ? "Link copied" : "Share"}
    </button>
  );
}
