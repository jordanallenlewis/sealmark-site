"use client";
import { useEffect, useRef, useState } from "react";

// One status per press: idle -> copied | selected | failed -> idle. data-state on the button carries it.
//   copied    the text is on the clipboard (Clipboard API, or the textarea + execCommand fallback for http/LAN)
//   selected  copying was refused, so the code block next to the button is selected for a manual copy
//   failed    nothing could be copied or selected
type Status = "idle" | "copied" | "selected" | "failed";
const RESET_MS: Record<Exclude<Status, "idle">, number> = { copied: 1400, selected: 4000, failed: 4000 };

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus();
  return ok;
}

/** Select the code block that sits next to the button (same parent or one level up), so Ctrl/Cmd+C copies it. */
function selectNearbyCode(btn: HTMLElement | null): boolean {
  const pre = btn?.parentElement?.querySelector("pre") ?? btn?.parentElement?.parentElement?.querySelector("pre");
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!pre || !sel) return false;
  sel.selectAllChildren(pre);
  return true;
}

export function CopyButton({ text, label = "Copy", className = "copybtn" }: { text: string; label?: string; className?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function settle(next: Exclude<Status, "idle">) {
    if (timer.current) clearTimeout(timer.current);
    setStatus(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setStatus("idle");
    }, RESET_MS[next]);
  }

  async function go() {
    try {
      await navigator.clipboard.writeText(text);
      settle("copied");
    } catch {
      if (legacyCopy(text)) settle("copied");
      else settle(selectNearbyCode(btn.current) ? "selected" : "failed");
    }
  }

  const shown = status === "copied" ? "✓ Copied" : status === "selected" ? "Selected, copy now" : status === "failed" ? "Copy failed" : label;
  return (
    <button ref={btn} type="button" className={className} onClick={go} aria-live="polite" data-state={status}>
      {shown}
    </button>
  );
}
