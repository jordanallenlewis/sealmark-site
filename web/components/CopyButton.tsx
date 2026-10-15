"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "copybtn" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<string>(label);
  const [copied, setCopied] = useState(false);
  async function go() {
    try {
      await navigator.clipboard.writeText(text);
      setState("Copied");
      setCopied(true);
    } catch {
      setState("Select + copy");
    }
    setTimeout(() => {
      setState(label);
      setCopied(false);
    }, 1400);
  }
  return (
    <button type="button" className={className} onClick={go} aria-live="polite" data-copied={copied ? "true" : undefined}>
      {copied ? "✓ " : ""}{state}
    </button>
  );
}
