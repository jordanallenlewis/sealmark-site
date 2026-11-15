export type ToolRow = { tool: string; called: { id: string; pack: string; verdict: string }[]; notCalled: { id: string; pack: string }[] };
export function toolVerdicts(x: { tools?: unknown; checks?: unknown[] }, redactions?: Map<string, unknown>): { rows: ToolRow[]; cut: boolean } | null;
