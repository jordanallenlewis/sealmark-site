export const LOOKUP_VERSION: string;
export interface LookupDoc { version: string; updated: string | null; count: number; server: string; keys: Record<string, string[]> }
export function npmKey(input: unknown): string | null;
export function pypiKey(input: unknown): string | null;
export function githubKey(input: unknown): string | null;
export function idKey(input: unknown): string | null;
export function ecosystemKey(x: { ecosystem: string; name: string }): string | null;
export function lookupKeys(input: unknown): string[];
export function resolveLookup(index: { keys?: Record<string, string[]> } | null | undefined, input: unknown): string[];
export function lookupIndex(servers: { id: string; ecosystem: string; name: string; repo: string | null; testedAt: string }[], site: string): LookupDoc;
export function lookupProblems(index: unknown, listed: { id: string; ecosystem: string; name: string; held: boolean }[], pageLinks: (id: string, url: string) => boolean): string[];
