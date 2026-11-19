import type { ToolCheck } from "./tool-verdicts.mjs";
export type ToolPage = { id: string; tool: string; slug: string; called: ToolCheck[]; notCalled: Omit<ToolCheck, "verdict">[] };
export function toolSlug(name: string): string;
export function toolPages<T>(servers: T[] | undefined, redactionsOf: (x: T) => Map<string, unknown>): ToolPage[];
export function toolSummary(a: { tool: string; server: string; version: string; testedAt: string; called: { id: string; verdict: string; advisory: boolean }[]; grade: { letter: string; provisional: boolean } | null }): string;
export function toolEvidence<L extends { tool: string | null }>(evidence: Map<string, { total: number; lines: L[] }> | null | undefined, called: { id: string }[], tool: string): { check: string; lines: L[] }[];
export function toolPagesProblems(built: string[], expected: { id: string; slug: string }[], status: (id: string) => "held" | "unknown" | null): string[];
