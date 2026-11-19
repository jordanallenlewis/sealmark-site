export const SERVER_GROUP: string;
export interface ServerSearchEntry { url: string; title: string; group: string; section: string; headings: string[]; text: string; grade: string }
export function serverEntry(x: unknown, label: { grade: string; source: string }, redactions: Map<string, unknown>): ServerSearchEntry;
export function serverEntries<T>(servers: T[], labelOf: (x: T) => { grade: string; source: string }, redactionsOf: (x: T) => Map<string, unknown>): ServerSearchEntry[];
