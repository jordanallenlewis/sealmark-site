// Grading formula and check list shared by the figures. gradePack() mirrors cli/src/grade.ts. The methodology version is
// the one docs:gen read from the CLI (content/generated/meta.json), so this file cannot name an older one.
// Real-server results live in lib/results.ts.
import meta from "@/content/generated/meta.json";

export const METHODOLOGY: string = meta.methodology;

export type PackId = "core" | "db";
export type Verdict = "pass" | "part" | "fail" | "inconclusive" | "na";
export type Letter = "A" | "B" | "C" | "D" | "F";

export type Check = {
  id: string;
  pack: PackId;
  label: string;
  short: string;
  sub: string;
  crit?: boolean;
  advisory?: boolean;
  probe: string;
};

// Check ids are the frozen contract ids from the design doc.
export const CHECKS: Check[] = [
  { id: "protocol", pack: "core", label: "Valid MCP handshake and tool schemas", short: "Handshake", sub: "+ schemas", probe: "initialize, then tools/list: tool names, duplicates, and inputSchema shapes are checked" },
  { id: "tool-poisoning", pack: "core", label: "No tool-poisoning indicators in tool metadata", short: "Tool", sub: "poisoning", crit: true, probe: "scan tool names and descriptions for hidden and control characters, send-to-URL phrasing, credential paths, and override phrases" },
  { id: "robust-input", pack: "core", label: "Survives malformed tool input", short: "Malformed", sub: "input", probe: "missing required arguments, wrong-type arguments and nulls (only values the tool's own schema rejects); expect a clean error, not a crash, hang, or stack trace" },
  { id: "secret-echo", pack: "core", label: "No environment secret echoed in responses", short: "Secret", sub: "echo", crit: true, probe: "start the server with canary variables (SEALMARK_CANARY, SEALMARK_FAKE_API_KEY), send bad input, look for the values in responses" },
  { id: "refusal-quality", pack: "core", label: "Refusals say what to do next", short: "Refusal", sub: "advisory", advisory: true, probe: "read every refusal the run recorded; a refusal routes when it names an alternative, a tool to call or why retrying will not help" },
  { id: "instructions-hygiene", pack: "core", label: "Server instructions name only tools that exist", short: "Instructions", sub: "advisory", advisory: true, probe: "read the server's instructions for tool names it does not offer and for checks.instructions-hygiene.deny patterns" },
  { id: "read-only", pack: "db", label: "Read-only by default", short: "Read-only", sub: "default", probe: "plain INSERT, UPDATE and DELETE through every SQL tool as the admin role, then read the tables back" },
  { id: "write-gate", pack: "db", label: "Write approval gate", short: "Write gate", sub: "advisory", advisory: true, probe: "derived from the read-only probes: did any plain write run with no approval step in the way?" },
  { id: "rls", pack: "db", label: "Row-level security respected", short: "Row-level", sub: "security", crit: true, probe: "support role selects rows that belong to the other tenant (two filtered selects and SELECT *), through every SQL tool" },
  { id: "mutating-sql", pack: "db", label: "Mutating SQL blocked", short: "Mutating", sub: "SQL", crit: true, probe: "16 forms as the admin role, such as COMMIT; INSERT · DO $$ … $$ · TRUNCATE · SELECT … INTO · /*x*/ iNsErT · PREPARE + EXECUTE · EXPLAIN ANALYZE, then check seed state" },
  { id: "pii", pack: "db", label: "Personal data masking respected", short: "Personal", sub: "data masking", crit: true, probe: "analyst role selects customers.email (and SELECT *) through every SQL tool, then looks for raw addresses" },
  { id: "pii-masked", pack: "db", label: "Masked data reachable", short: "Masked", sub: "data", probe: "analyst role selects id and email from the masked view; a server that denies everything is not masking" },
  { id: "db-rowcap", pack: "db", label: "Row cap", short: "Row", sub: "cap", probe: "SELECT id, payload FROM big_table (200k rows); expect a capped result, not everything" },
  { id: "db-timeout", pack: "db", label: "Statement timeout", short: "Statement", sub: "timeout", probe: "pg_sleep longer than --timeout-probe (default 10 s); expect the statement to end at the timeout" },
  { id: "audit", pack: "db", label: "Every call logged", short: "Audit", sub: "advisory", advisory: true, probe: "not measured: servers do not write audit rows by themselves, so this is always n/a" },
  { id: "db-privilege", pack: "db", label: "Connects as the database role it was given", short: "Role", sub: "privilege", advisory: true, probe: "list the database backends before and after each instance starts, ask it for current_user, and read that role's attributes (superuser, BYPASSRLS, table owner)" },
];

export const checksOf = (pack: PackId) => CHECKS.filter((c) => c.pack === pack);

export const RANK: Record<Letter, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

export function letterFor(pct: number): Letter {
  return pct >= 0.9 ? "A" : pct >= 0.75 ? "B" : pct >= 0.6 ? "C" : pct >= 0.45 ? "D" : "F";
}

export type PackGrade = {
  points: number;
  scored: number;
  total: number;
  pct: number;
  raw: Letter;
  letter: Letter;
  capped: boolean;
  criticalFails: string[];
  provisional: boolean;
  excluded: number;
};

// Same rules as gradePack in the design doc: advisory checks never count; only pass/part/fail are scored
// (1 / 0.5 / 0); inconclusive and n/a are excluded; a critical fail caps a better grade at D (an F stays F);
// an inconclusive critical check makes the grade provisional. Returns null when nothing is scored.
export function gradePack(pack: PackId, s: { r: Record<string, Verdict> }): PackGrade | null {
  const checks = checksOf(pack).filter((c) => !c.advisory && s.r[c.id] !== undefined);
  let points = 0;
  let scored = 0;
  let provisional = false;
  let excluded = 0;
  const criticalFails: string[] = [];
  for (const c of checks) {
    const v = s.r[c.id];
    if (v === "pass" || v === "part" || v === "fail") {
      scored++;
      points += v === "pass" ? 1 : v === "part" ? 0.5 : 0;
      if (c.crit && v === "fail") criticalFails.push(c.label);
    } else {
      excluded++;
      if (c.crit && v === "inconclusive") provisional = true;
    }
  }
  if (scored === 0) return null;
  const pct = points / scored;
  const raw = letterFor(pct);
  const letter: Letter = criticalFails.length && RANK[raw] < RANK.D ? "D" : raw;
  return { points, scored, total: checks.length, pct, raw, letter, capped: letter !== raw, criticalFails, provisional, excluded };
}
