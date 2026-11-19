export type ToolDirectoryRow = { id: string; name: string; testedAt: string; tools: string[]; declared: number; missing: boolean };
export function toolDirectory<T>(servers: T[] | undefined, redactionsOf: (x: T) => Map<string, unknown>): { rows: ToolDirectoryRow[]; tools: number };
export function toolsPageProblems(html: string, listed: Set<string>, status: (id: string) => "held" | "unknown" | null): string[];
