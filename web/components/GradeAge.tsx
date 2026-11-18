"use client";
import { useSyncExternalStore } from "react";
import { ageNote, isStale } from "@/lib/grade-age.mjs";

// How old a grade is, by the reader's clock (site#63). The static page is built only when the fleet deploys, so an age
// worked out at build time would stop moving if the fleet stopped: the server render uses the build day (no JavaScript
// still gets a true age as of the build), and the browser swaps in its own UTC day after hydration.
const noSubscribe = () => () => {};
const browserDay = () => new Date().toISOString().slice(0, 10);

/** Today's UTC day: the build day while rendering on the server and hydrating, then the browser's. */
export function useToday(builtOn: string): string {
  return useSyncExternalStore(noSubscribe, browserDay, () => builtOn);
}

/** " (3 days ago)" after a test date; the waiting-for-re-test words past the limit; nothing when the age is unknown. */
export function GradeAge({ testedAt, builtOn }: { testedAt: string | undefined; builtOn: string }) {
  const today = useToday(builtOn);
  const note = ageNote(testedAt, today);
  return note ? <span data-state={isStale(testedAt, today) ? "stale" : "current"}> ({note})</span> : null;
}
