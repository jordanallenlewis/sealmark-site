export const MAX_INPUT: number;
export const MAX_FRAGMENT: number;
export const MAX_TEXT: number;
export const MAX_CHECKS: number;
export const MAX_EVIDENCE: number;
export const MAX_RUNS: number;
export interface ViewEvidence { probe: string; outcome: string; verifiedBy: string; tool: string | null; role: string | null }
export interface ViewCheck { id: string; pack: string; label: string; scope: string; verdict: "pass" | "part" | "fail" | "inconclusive" | "na"; summary: string; critical: boolean; advisory: boolean; evidence: ViewEvidence[]; evidenceCut: number }
export interface ViewPack { id: string; status: "graded" | "na" | "inconclusive"; letter: "A" | "B" | "C" | "D" | "F" | null; pct: number | null; provisional: boolean; capped: boolean; reason: string | null }
export interface ViewRun { server: { name: string; version: string; command: string; transport: string }; sealmark: { version: string; methodology: string }; startedAt: string; standard: boolean | null; configHash: string | null; coverage: string | null; packs: ViewPack[]; checks: ViewCheck[]; checksCut: number; notCovered: string[]; warnings: string[] }
export type ParseResult = { ok: true; runs: ViewRun[]; failed: { server: string }[] } | { ok: false; error: string };
export function text(v: unknown, max?: number): string;
export function parseReport(input: unknown): ParseResult;
export function toBase64Url(bytes: Uint8Array): string;
export function fragmentBytes(hash: string): Uint8Array | null;
