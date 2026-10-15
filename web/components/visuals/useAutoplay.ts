"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Shared autoplay hook for the visuals.
//
//   const { playing, frame, setFrame } = useAutoplay(ref, { loopMs });
//
// - `playing` is false on the server and before the first IntersectionObserver callback, so the first
//   paint is always the complete resting state. It becomes true only while the element is at least 40%
//   visible (or covers most of the viewport, for figures taller than the screen) and motion is allowed.
// - Motion is "not allowed" when prefers-reduced-motion is set or <html> carries the `reduce` class.
//   Both are watched live, so toggling the class from the console stops a running figure at once.
// - `frame` advances by one every `loopMs` while playing. By default it is a bare counter (use
//   `frame % n`); pass `frames` to make it wrap. `setFrame(n, holdMs?)` jumps to a frame, restarts the
//   timer so the chosen frame gets a full interval (or `holdMs` if given), and works when not playing.
//
// Extra, optional and backward compatible: `frames`, `auto` (false = never plays; dots still work),
// `threshold`, and a `reduced` flag in the result.

type Opts = {
  loopMs: number;
  frames?: number;
  auto?: boolean;
  threshold?: number;
};

type Result = {
  playing: boolean;
  frame: number;
  setFrame: (n: number, holdMs?: number) => void;
  reduced: boolean;
};

const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

export function useAutoplay(ref: RefObject<Element | null>, { loopMs, frames, auto = true, threshold = 0.4 }: Opts): Result {
  const [frame, setFrameState] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const hold = useRef<number | null>(null);
  const playing = auto && visible && !reduced;

  // visibility: at least `threshold` of the element, or most of the viewport when the element is taller than it
  useEffect(() => {
    const el = ref.current;
    if (!el || !auto || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        const vh = e.rootBounds?.height ?? window.innerHeight;
        setVisible(e.isIntersecting && (e.intersectionRatio >= threshold || e.intersectionRect.height >= vh * 0.8));
      },
      { threshold: STEPS },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, auto, threshold]);

  // reduced motion: media query plus the `reduce` class on <html>, both live
  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(mq.matches || html.classList.contains("reduce"));
    read();
    mq.addEventListener("change", read);
    const mo = new MutationObserver(read);
    mo.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", read); mo.disconnect(); };
  }, []);

  // the clock: one timeout per frame, so any frame change (including setFrame) restarts the interval
  useEffect(() => {
    if (!playing) return;
    const wait = hold.current ?? loopMs;
    hold.current = null;
    const t = setTimeout(() => setFrameState((f) => (frames ? (f + 1) % frames : f + 1)), wait);
    return () => clearTimeout(t);
  }, [playing, frame, loopMs, frames]);

  const setFrame = useCallback((n: number, holdMs?: number) => {
    hold.current = holdMs ?? null;
    setFrameState(frames ? ((n % frames) + frames) % frames : n);
  }, [frames]);

  return { playing, frame, setFrame, reduced };
}
