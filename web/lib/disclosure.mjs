// Which check results the public site may show in full, and which stay redacted under the disclosure policy
// (app/disclosure, /disclosure/). Pure functions, no I/O: covered by lib/disclosure.test.mjs.
//
// Fail closed: a check is public only when its id is on PUBLIC_CHECKS, an explicit list of checks that are not
// security findings. Any other id, including one a newer CLI adds before this list is updated, counts as security.
//
// KEEP IN SYNC with fleet/security-checks.mjs, which decides the same thing for the owner notices (a repository
// with a security finding gets a private report, not a public issue). That file lists the security checks; this one
// lists the rest. lib/disclosure.test.mjs fails when the two disagree on any check in content/generated/checks.json.

/** Checks that are not security findings: their evidence is always public. Everything else is security. */
export const PUBLIC_CHECKS = new Set([
  // scored, not critical, and not a security boundary
  "protocol", "robust-input",
  "read-only", "pii-masked", "db-rowcap", "db-timeout",
  "http-protocol-version",
  "fs-size-cap",
  "net-caps",
  "sqlite-read-only", "sqlite-rowcap", "sqlite-timeout",
  "exec-timeout-cap",
  "sql-guard-rowcap",
  "upstream-slow",
  "oauth-discovery",
  "openworld-honesty",
  // advisory: never scored, never a finding (fleet/security-checks.mjs skips advisory checks too)
  "refusal-quality", "instructions-hygiene",
  "write-gate", "audit", "db-privilege",
  "http-session-binding", "http-bind", "http-tls",
  "exec-allowlist",
  "undeclared-writes",
]);

// Security checks whose "part" verdict is a weak signal, not a finding: tool-poisoning's "weak indicators, none
// conclusive", annotation-honesty's "only caches changed", a data: URL accepted with no file read. They are shown in
// full, styled as a weak signal. A "part" on any other security check is treated as a finding (fail closed);
// fleet/security-checks.mjs PART_IS_FINDING lists the ones known to be partial bypasses.
export const WEAK_PART = new Set(["tool-poisoning", "annotation-honesty", "net-scheme-allowlist"]);

/** @typedef {{ id: string, critical?: boolean, advisory?: boolean, verdict?: string }} CheckLike */

/** @param {CheckLike} check */
export function isSecurityCheck(check) {
  if (check.critical === true) return true;
  return !PUBLIC_CHECKS.has(check.id);
}

/** A security check whose verdict is a finding: fail, or part that is not a known weak signal. @param {CheckLike} check */
export function isSecurityFinding(check) {
  if (!isSecurityCheck(check)) return false;
  return check.verdict === "fail" || (check.verdict === "part" && !WEAK_PART.has(check.id));
}

/** A part verdict that only hints at a problem. @param {CheckLike} check */
export function isWeakSignal(check) {
  return check.verdict === "part" && WEAK_PART.has(check.id) && isSecurityCheck(check);
}

// Status of one finding, set by hand in content/data/disclosure.json:
//   pending-report  found, not reported yet (the default for a finding with no entry)
//   reported        reported privately on reportedAt; details go public on publishAfter (default reportedAt + 90 days)
//   fixed           a fixed version is out; details are public
//   published       the report is public
export const STATUSES = ["pending-report", "reported", "fixed", "published"];
const DAY = 86_400_000;

/** @param {string} date YYYY-MM-DD @param {number} days */
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** @typedef {{ status: string, reportedAt?: string | null, publishAfter?: string | null }} DisclosureEntry */
/** @typedef {{ status: string, reportedAt: string | null, publishAfter: string | null, redacted: boolean }} Disclosure */

/**
 * The disclosure state of one finding. A missing or malformed entry is "pending-report" and redacted.
 * @param {Record<string, DisclosureEntry>} entries keyed by "<server id>/<check id>"
 * @param {string} serverId
 * @param {string} checkId
 * @param {string} today YYYY-MM-DD
 * @returns {Disclosure}
 */
export function disclosureFor(entries, serverId, checkId, today) {
  const e = entries?.[`${serverId}/${checkId}`];
  const status = e && STATUSES.includes(e.status) ? e.status : "pending-report";
  const reportedAt = e?.reportedAt && /^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt) ? e.reportedAt : null;
  const publishAfter = e?.publishAfter && /^\d{4}-\d{2}-\d{2}$/.test(e.publishAfter) ? e.publishAfter : reportedAt ? addDays(reportedAt, 90) : null;
  const redacted = status === "fixed" || status === "published" ? false : status === "reported" && publishAfter ? today < publishAfter : true;
  return { status, reportedAt, publishAfter, redacted };
}

/**
 * The checks on one server that the public page must redact.
 * @param {{ id: string, checks?: CheckLike[] }} server
 * @param {Record<string, DisclosureEntry>} entries
 * @param {string} today YYYY-MM-DD
 * @returns {Map<string, Disclosure>} check id -> disclosure state, only for redacted checks
 */
export function redactedChecks(server, entries, today) {
  const out = new Map();
  for (const c of server.checks ?? []) {
    if (!isSecurityFinding(c)) continue;
    const d = disclosureFor(entries, server.id, c.id, today);
    if (d.redacted) out.set(c.id, d);
  }
  return out;
}
