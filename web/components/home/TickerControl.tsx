"use client";
import { useState, type ReactNode } from "react";
import { PlayPause } from "@/components/PlayPause";
import s from "./ResultsTicker.module.css";

// Client shell around the server-rendered ticker: one state, playing | paused, on the root as data-state.
// Hover and keyboard focus still pause it in CSS; under reduced motion nothing moves and the button is hidden in CSS.
export function TickerControl({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"playing" | "paused">("playing");
  return (
    <div className={s.shell} data-state={state}>
      {children}
      <PlayPause paused={state === "paused"} onToggle={() => setState((v) => (v === "paused" ? "playing" : "paused"))} className={s.pp} />
    </div>
  );
}
