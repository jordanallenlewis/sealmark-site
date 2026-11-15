// Types for lib/badge.mjs (plain JS so node --test can load it).
type Letter = "A" | "B" | "C" | "D" | "F";
type Snippets = { markdown: string; html: string; rst: string };
export const ORIGIN: string;
export function clip(t: string, max: number): string;
export function badgeSvg(label: string, message: string, letter: Letter, note?: string | null): string;
export function badgeCardSvg(card: { name: string; version: string; testedAt: string; message: string; letter: Letter; note?: string | null }): string;
export function shieldsDoc(label: string, message: string, letter: Letter): { schemaVersion: 1; label: string; message: string; color: string };
export function badgeSnippets(id: string): { page: string; urls: { svg: string; card: string; shields: string; json: string }; badge: Snippets; card: Snippets; shields: Snippets };
export function badgeFiles(ids: string[]): { file: string; kind: "svg" | "card" | "json"; id: string }[];
