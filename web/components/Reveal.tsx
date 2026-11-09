"use client";
import { clsx } from "clsx";
import { useEffect, useRef, type ReactNode, type ElementType } from "react";

export function Reveal({ children, as: Tag = "div", className = "", delay = 0 }: { children: ReactNode; as?: ElementType; className?: string; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return; // already visible: the finished state is the default
    // Hide only what starts below the fold (it fades in when reached); anything in view or above stays as painted.
    if (el.getBoundingClientRect().top > window.innerHeight && !document.documentElement.classList.contains("reduce")) el.classList.add("pre");
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { el.classList.add("in"); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={clsx("rv", className)} style={{ "--d": `${Math.min(delay, 120)}ms` } as React.CSSProperties}>{children}</Tag>;
}

// Adds the .reduce class to <html> when the user prefers reduced motion.
export function MotionPref() {
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => document.documentElement.classList.toggle("reduce", m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  return null;
}
