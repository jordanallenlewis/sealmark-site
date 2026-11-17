// What each check observed, kept for the evidence viewer on the results pages (site#65). Pure functions, no I/O;
// fleet/merge.mjs calls them for every graded report and writes fleet/evidence.json. Tests: fleet/evidence.test.mjs.
//
// This repository is public, so the rule is the one fleet/check-tools.mjs uses for tool names, and it fails closed:
// - nothing at all for a server with any security finding by the site's own rule (web/lib/disclosure.mjs
//   isSecurityFinding, which also holds an unknown or private id that a newer CLI flags advisory): a sibling check's
//   evidence could point to it;
// - only scored public-class checks (fleet/security-checks.mjs isPublicCheck). Never a security check (even a pass: a
//   verdict can be wrong, and a probe's raw outcome could then describe a real weakness), never an advisory check (their
//   probes can show how a weakness was shown; publishing that detail is a disclosure-policy call), never a critical
//   result or an id fleet/security-checks.mjs does not know.
// Each line keeps the probe, the outcome, how the CLI verified it and the tool name. Never the arguments, the response
// excerpt, the machine code or the role. The CLI has already redacted the report (sandbox paths, ports, run tokens,
// secrets); this scrubs runner paths and token shapes again, strips control and invisible characters and cuts each text.
// No verdict or grade is read or changed here.
import { plainNames } from "./check-tools.mjs";
import { isPublicCheck } from "./security-checks.mjs";
import { isSecurityFinding } from "../web/lib/disclosure.mjs";

/** Lines kept per check (the first ones, in the CLI's order) and characters kept per text. */
export const MAX_LINES = 6;
export const MAX_TEXT = 240;

/** How a line was verified (the CLI's `VerifiedBy`); any other value is dropped. */
const SOURCES = new Set(["db-state", "response", "protocol", "static", "fs-observer", "listener", "process", "http", "upstream", "log", "authserver"]);

const VERDICTS = new Set(["pass", "part", "fail", "inconclusive", "na"]);

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,40})?$/;

/** @param {unknown} v */
function text(v) {
  if (typeof v !== "string") return "";
  const t = v
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\/(home|Users|runner)\/[^\s:)"']+/g, "<path>")
    .replace(/\b(gh[pousr]_|github_pat_|sk-|xox[bap]-|AKIA)[A-Za-z0-9_-]{8,}/g, "<secret>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<token>")
    .trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** @param {unknown} e */
function evidenceLine(e) {
  if (!e || typeof e !== "object") return undefined;
  const probe = text(e.probe);
  const outcome = text(e.outcome);
  if (!probe && !outcome) return undefined;
  const out = { probe, outcome };
  if (SOURCES.has(e.verifiedBy)) out.by = e.verifiedBy;
  const tool = plainNames([e.tool])[0];
  if (tool) out.tool = tool;
  return out;
}

/**
 * The evidence record for one graded report, or undefined when nothing may be kept.
 * @param {{ startedAt?: string, sealmark?: { version?: string }, config?: { hash?: string }, checks?: unknown } | null | undefined} report
 * @returns {{ testedAt: string, sealmark: string | null, configHash: string, checks: Record<string, { verdict: string, total: number, lines: object[] }> } | undefined}
 */
export function checkEvidence(report) {
  if (!report || typeof report !== "object" || !Array.isArray(report.checks)) return undefined;
  const checkList = report.checks.filter((c) => c && typeof c === "object");
  if (checkList.some((c) => isSecurityFinding(c))) return undefined;
  const checks = {};
  for (const c of checkList) {
    if (typeof c.id !== "string" || c.id === "__proto__" || !isPublicCheck(c) || !Array.isArray(c.evidence)) continue;
    const lines = c.evidence.map(evidenceLine).filter(Boolean);
    if (!lines.length) continue;
    // The verdict this run gave the check, so the page shows the lines only beside the verdict they came from.
    if (!VERDICTS.has(c.verdict)) continue;
    checks[c.id] = { verdict: c.verdict, total: lines.length, lines: lines.slice(0, MAX_LINES) };
  }
  if (!Object.keys(checks).length) return undefined;
  return {
    testedAt: String(report.startedAt ?? "").slice(0, 10),
    sealmark: VERSION.test(String(report.sealmark?.version ?? "")) ? report.sealmark.version : null,
    configHash: String(report.config?.hash ?? "").slice(0, 19),
    checks,
  };
}

/**
 * The evidence file after a run: each graded server's record replaced, or removed when its new run keeps none (so a
 * server that gains a finding loses its old evidence the same run). Only ids in `keep` (the servers still in the
 * results) stay. Keys sorted for small diffs.
 * @param {Record<string, object>} all @param {[string, object | undefined][]} updates @param {Set<string>} keep
 */
export function mergeEvidence(all, updates, keep) {
  const out = new Map(Object.entries(all ?? {}).filter(([id]) => keep.has(id)));
  for (const [id, rec] of updates) {
    if (typeof id !== "string" || id === "__proto__") continue;
    if (rec && keep.has(id)) out.set(id, rec);
    else out.delete(id);
  }
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
