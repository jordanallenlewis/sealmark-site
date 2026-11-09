// Grade history, built at build time from fleet/history.jsonl (one line per server per fleet run; the file is appended by
// the fleet workflow). Static: no database. Same-day lines for one server collapse to the last one.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVERS_RESULTS, type Letter } from "@/lib/results";

export type Run = { date: string; version: string; sealmark?: string; status: "ok" | "failed"; worst?: Letter; packs: Record<string, Letter> };
export type ServerHistory = { id: string; name: string; linked: boolean; runs: Run[] };

// reddit-research-mcp is pinned first (owner, 2026-11-09); every other tracked server follows by name.
const PINNED = ["reddit-research-mcp"];

export function loadHistory(): ServerHistory[] {
  const file = resolve(process.cwd(), "..", "fleet", "history.jsonl");
  const byId = new Map<string, Map<string, Run>>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { id: string; version?: string; sealmark?: string; testedAt: string; status: string; worst?: Letter; packs?: Record<string, Letter> };
    const days = byId.get(r.id) ?? new Map<string, Run>();
    days.set(r.testedAt, { date: r.testedAt, version: r.version ?? "", sealmark: r.sealmark, status: r.status === "ok" ? "ok" : "failed", worst: r.worst, packs: r.packs ?? {} });
    byId.set(r.id, days);
  }
  const out: ServerHistory[] = [...byId].map(([id, days]) => {
    const known = SERVERS_RESULTS.find((x) => x.id === id);
    return { id, name: known?.name ?? id, linked: !!known, runs: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
  const rank = (id: string) => (PINNED.includes(id) ? PINNED.indexOf(id) : PINNED.length);
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

export const historyFor = (id: string) => loadHistory().find((h) => h.id === id);
