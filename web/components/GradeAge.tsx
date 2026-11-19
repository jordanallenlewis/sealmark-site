"use client";
import { useSyncExternalStore } from "react";
import s from "@/app/results/results.module.css";
import { ageNote, isStale, staleSince } from "@/lib/grade-age.mjs";

// How old a grade is, by the reader's clock (site#63). The static page is built only when the fleet deploys, so a
// relative age worked out at build time ("4 days ago") would be frozen if deploys stopped. The server render (and readers
// without JavaScript) get only the stale mark, which stays true until the next build; the browser swaps in the real age
// from its own UTC day after hydration.
const noSubscribe = () => () => {};
const browserDay = () => new Date().toISOString().slice(0, 10);
const noClock = () => null;

/** The reader's UTC day, or null while rendering on the server and hydrating. */
export function useToday(): string | null {
  return useSyncExternalStore(noSubscribe, browserDay, noClock);
}

/** " (3 days ago)" after a test date, the waiting-for-re-test words past the limit, nothing when the age is unknown. */
export function GradeAge({ testedAt, builtOn }: { testedAt: string | undefined; builtOn: string }) {
  const today = useToday();
  const note = today ? ageNote(testedAt, today) : staleSince(testedAt, builtOn, "page");
  // Always rendered: the line is reserved before the reader's clock arrives, so the words fill a box that already exists (no layout shift).
  return <span className={s.metaAge} data-state={isStale(testedAt, today ?? builtOn) ? "stale" : "current"}>{note ? `(${note})` : ""}</span>;
}
