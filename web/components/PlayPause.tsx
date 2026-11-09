"use client";
import { clsx } from "clsx";
import s from "./PlayPause.module.css";

// The one pause/play control for anything that moves on its own (WCAG 2.2.2). The label swaps
// ("Pause animation" / "Play animation"); there is no aria-pressed, so the name alone says what a press does.
export function PlayPause({ paused, onToggle, hidden, className }: { paused: boolean; onToggle: () => void; hidden?: boolean; className?: string }) {
  return (
    <button type="button" className={clsx(s.btn, className)} onClick={onToggle} hidden={hidden} aria-label={paused ? "Play animation" : "Pause animation"} data-state={paused ? "paused" : "playing"}>
      <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true" focusable="false">
        {paused ? <path d="M2 1l7 4-7 4z" fill="currentColor" /> : <path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" />}
      </svg>
      {paused ? "play" : "pause"}
    </button>
  );
}
