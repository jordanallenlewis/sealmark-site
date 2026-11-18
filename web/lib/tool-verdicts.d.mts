export type ToolCheck = { id: string; pack: string; verdict: string; advisory: boolean };
export type ToolRow = { tool: string; called: ToolCheck[]; notCalled: Omit<ToolCheck, "verdict">[] };
export function toolVerdicts(x: { tools?: unknown; toolCount?: number; checks?: unknown[] }, redactions?: Map<string, unknown>): { rows: ToolRow[]; missing: boolean } | null;
export function plain(n: unknown): boolean;
