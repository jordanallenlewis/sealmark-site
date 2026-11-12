// Types and helpers for the real-server results, without the data file, so client components can import them.
export type Verdict = "pass" | "part" | "fail" | "inconclusive" | "na";
export type Letter = "A" | "B" | "C" | "D" | "F";
export type PackResult = { id: string; status: string; letter: Letter | null; points: number | null; scored: number | null; pct: number | null; provisional: boolean; capped: boolean; criticalFails: string[]; reason?: string | null };
export type CheckResult = { id: string; pack: string; label: string; critical: boolean; advisory: boolean; verdict: Verdict; summary: string };
export type ServerResult = {
  id: string; name: string; ecosystem: "npm" | "pypi" | "github"; versionTested: string; testedAt: string;
  sealmark: { version: string; methodology: string }; standard: boolean | null; configHash: string; launch: string; transport: string; toolCount: number;
  packs: PackResult[]; checks: CheckResult[];
  coverage?: { level: string; validCalls: number; toolsCalledValid: number; toolsTotal: number } | null;
  badge?: { eligible: boolean; reason?: string } | null;
  notCovered: string[]; warnings: string[];
  automated?: boolean; round?: string;
  // set by fleet/merge.mjs when the latest re-test failed; the grade above is from the earlier run (web/lib/retest.mjs)
  lastAttempt?: { date: string; status: "failed"; kind: string } | null;
};

export const RANK: Record<Letter, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
export const PACK_LABEL: Record<string, string> = { core: "Protocol", db: "Database", sqlite: "SQLite", fs: "Files", git: "Git", net: "Network", http: "HTTP", effects: "Effects", exec: "Commands", custom: "Custom" };

export const gradedPacks = (s: ServerResult) => s.packs.filter((p) => p.status === "graded" && p.letter);
export const worst = (s: ServerResult): { letter: Letter; provisional: boolean } | null => {
  const g = gradedPacks(s);
  if (!g.length) return null;
  const w = g.reduce((a, b) => (RANK[b.letter as Letter] < RANK[a.letter as Letter] ? b : a));
  return { letter: w.letter as Letter, provisional: w.provisional };
};
export const deepPacks = (s: ServerResult) => gradedPacks(s).filter((p) => p.id !== "core");
export const coverageWord = (s: ServerResult) =>
  !s.coverage ? "unknown" : s.coverage.level === "covered" ? "covered" : s.coverage.level === "low" ? "low" : "hygiene only";
export const launchLine = (s: ServerResult) => (s.ecosystem === "npm" ? `npx -y ${s.name}@${s.versionTested}` : s.ecosystem === "github" ? s.launch : `uvx ${s.name}==${s.versionTested}`);
export const ecosystemLabel = (s: ServerResult) => (s.ecosystem === "npm" ? "npm" : s.ecosystem === "github" ? "GitHub" : "PyPI");
