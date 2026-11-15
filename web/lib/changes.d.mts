import type { Letter } from "./results-shared";

export type RunLite = { date: string; version: string; sealmark?: string; status: "ok" | "failed"; packs: Record<string, Letter> };
export type ChangeItem =
  | { kind: "version"; from: string; to: string }
  | { kind: "sealmark"; from: string; to: string }
  | { kind: "grade"; pack: string; from: Letter; to: Letter; dir: "up" | "down" }
  | { kind: "gone"; pack: string; from: Letter }
  | { kind: "new"; pack: string; to: Letter }
  | { kind: "tools"; from: number; to: number; dir: "up" | "down" };
export type RunRef = { date: string; version: string; sealmark?: string };
export type Change = { from: RunRef; to: RunRef; failedBetween: number; items: ChangeItem[]; gradeChanged: boolean };
export function changeSinceLast(runs: RunLite[], testedAt: string, toolCounts?: Record<string, number>): Change | null;
export function toolCountsFrom(text: string, id: string): Record<string, number>;
