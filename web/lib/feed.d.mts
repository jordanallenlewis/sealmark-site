export type FeedChange = { date: string; id: string; name: string; from: string; to: string; packs: Record<string, { from: string | null; to: string | null }>; previousVersion: string; version: string; previousSealmark: string | null; sealmark: string | null; page: string };
export type FeedEntry = { id: string; title: string; url: string; updated: string; summary: string };
export function feedChanges(changes: unknown, isHeld: (id: string) => boolean): FeedChange[];
export function changeEntry(c: FeedChange, label: (pack: string) => string): FeedEntry;
export function xmlText(v: unknown): string;
export function atomFeed(f: { id: string; title: string; subtitle?: string; self: string; page: string; updated: string; entries: FeedEntry[] }): string;
export function feedProblems(xml: string, origin: string, listed: Set<string>, status: (id: string) => "held" | "unknown" | null, only?: string): string[];
export function isFeedHeld(x: { checks?: unknown[] } | undefined, redactions: Map<string, unknown>): boolean;
export function historyInSync(runs: { status: string; worst?: string }[] | undefined, current: string | null | undefined): boolean;
