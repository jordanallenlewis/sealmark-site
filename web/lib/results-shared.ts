// Types and helpers for the real-server results, without the data file, so client components can import them.
export type Verdict = "pass" | "part" | "fail" | "inconclusive" | "na";
export type Letter = "A" | "B" | "C" | "D" | "F";
export type PackResult = { id: string; status: string; letter: Letter | null; points: number | null; scored: number | null; pct: number | null; provisional: boolean; capped: boolean; criticalFails: string[]; reason?: string | null };
export type CheckResult = { id: string; pack: string; label: string; critical: boolean; advisory: boolean; verdict: Verdict;
  /** null for a check held under private disclosure: fleet/redact-results.mjs keeps its text out of the public file. */
  summary: string | null;
  /** Tools this check called with a valid call, and the ones it could not (fleet/check-tools.mjs; public checks only). */
  tools?: { probed: string[]; notCovered: string[]; cut?: number } };
export type ServerResult = {
  id: string; name: string; ecosystem: "npm" | "pypi" | "github"; versionTested: string; testedAt: string;
  sealmark: { version: string; methodology: string }; standard: boolean | null; configHash: string; launch: string; transport: string; toolCount: number;
  /** Tool names the server declared in this run (fleet/check-tools.mjs); absent until the fleet re-tests it. */
  tools?: string[];
  /** Each tool's input schema as a 12-character hash, and the hashes of the last graded run on an earlier day (fleet/check-tools.mjs). */
  toolSchemas?: Record<string, string>;
  toolSchemasBefore?: { date: string; schemas: Record<string, string> };
  packs: PackResult[]; checks: CheckResult[];
  coverage?: { level: string; validCalls: number; toolsCalledValid: number; toolsTotal: number } | null;
  badge?: { eligible: boolean; reason?: string } | null;
  notCovered: string[]; warnings: string[];
  automated?: boolean; round?: string;
  // set by fleet/merge.mjs when the latest re-test failed; the grade above is from the earlier run (web/lib/retest.mjs)
  lastAttempt?: { date: string; status: "failed"; kind: string; startKind?: string } | null;
  /** Set when the file loads (lib/results.ts, lib/retest.mjs withdrawnGrade): the grade is 6 or more days old and the re-tests keep failing, so no overall grade is shown. */
  gradeWithdrawn?: { kind: string; text?: string; since: string } | null;
};

type PackLite = Pick<PackResult, "id" | "status" | "letter" | "provisional">;
/** What the /results/ table receives: the allowlisted fields of lib/results-list.mjs, nothing else. */
export type ListRow = Pick<ServerResult, "id" | "name" | "ecosystem" | "versionTested" | "toolCount" | "lastAttempt" | "gradeWithdrawn"> & {
  packs: PackLite[];
  coverage?: { level: string; toolsTotal: number } | null;
  /** Day of the run behind the grade (YYYY-MM-DD), and the last day the server grade moved with a new server version (lib/results-view.mjs gradeChange). */
  testedOn?: string;
  change?: { date: string; from: Letter; to: Letter; fromVersion: string };
};

export const RANK: Record<Letter, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
export const PACK_LABEL: Record<string, string> = { core: "Protocol", db: "Database", sqlite: "SQLite", fs: "Files", git: "Git", net: "Network", http: "HTTP", effects: "Effects", exec: "Commands", custom: "Custom" };

export const gradedPacks = <P extends PackLite>(s: { packs: P[] }) => s.packs.filter((p) => p.status === "graded" && p.letter);
export const worst = (s: { packs: PackLite[]; gradeWithdrawn?: unknown }): { letter: Letter; provisional: boolean } | null => {
  if (s.gradeWithdrawn) return null; // a stale grade whose re-tests keep failing is not shown (lib/retest.mjs withdrawnGrade)
  const g = gradedPacks(s);
  if (!g.length) return null;
  const w = g.reduce((a, b) => (RANK[b.letter as Letter] < RANK[a.letter as Letter] ? b : a));
  return { letter: w.letter as Letter, provisional: w.provisional };
};
export const deepPacks = <P extends PackLite>(s: { packs: P[] }) => gradedPacks(s).filter((p) => p.id !== "core");
export const coverageWord = (s: Pick<ListRow, "coverage">) =>
  !s.coverage ? "unknown" : s.coverage.level === "covered" ? "covered" : s.coverage.level === "low" ? "low" : "hygiene only";
export const launchLine = (s: ServerResult) => (s.ecosystem === "npm" ? `npx -y ${s.name}@${s.versionTested}` : s.ecosystem === "github" ? s.launch : `uvx ${s.name}==${s.versionTested}`);
export const ecosystemLabel = (s: Pick<ServerResult, "ecosystem">) => (s.ecosystem === "npm" ? "npm" : s.ecosystem === "github" ? "GitHub" : "PyPI");
