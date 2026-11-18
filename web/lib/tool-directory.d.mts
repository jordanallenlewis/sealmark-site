export type ToolDirectoryRow = { id: string; name: string; tools: string[]; declared: number; missing: boolean };
export function toolDirectory<T>(servers: T[] | undefined, redactionsOf: (x: T) => Map<string, unknown>): { rows: ToolDirectoryRow[]; tools: number };
