// Types for lib/api.mjs (plain JS so node --test can load it).
type Grade = { letter: string; provisional: boolean } | null;
type Run = { date: string; version: string; sealmark?: string; status: string; worst?: string; packs: Record<string, string> };
type Redactions = Map<string, { status: string; reportedAt: string | null; publishAfter: string | null }>;
export const API_VERSION: string;
export const API_BASE: string;
export const CHANGES_LIMIT: number;
export function serverPath(id: string): string;
export function pagePath(id: string): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Server = any;
export function serverSummary(x: Server, grade: Grade, site: string): Record<string, unknown>;
export function serverDoc(x: Server, grade: Grade, redactions: Redactions, runs: Run[], site: string): Record<string, unknown>;
export function serversDoc(items: Record<string, unknown>[], methodology: string): Record<string, unknown>;
export function changesDoc(histories: { id: string; name: string; linked: boolean; runs: Run[] }[], site: string, limit?: number): Record<string, unknown>;
export function openapiDoc(site: string, cliVersion: string): Record<string, unknown>;
