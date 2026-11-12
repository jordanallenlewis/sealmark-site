// Which check results the public site may show in full, and which stay redacted under the disclosure policy
// (app/disclosure, /disclosure/). Pure functions, no I/O: covered by lib/disclosure.test.mjs.
//
// ONE SOURCE OF TRUTH: fleet/security-checks.mjs, which also decides which checks a public owner issue may name.
// The site imports its classification instead of keeping a copy, so the results pages and the owner notices cannot
// drift apart. Fail closed: a check is public only when the result does not mark it critical and that file classifies
// its id as "public", or as "advisory" and the result is advisory too (an advisory check that a newer CLI starts to
// score is security until it is reclassified). Any other id, including one a newer CLI adds before the fleet file is
// updated, counts as security. An advisory flag alone never makes a check public here: the id decides first.
import { CHECK_CLASS, WEAK_PART as FLEET_WEAK_PART, isWeakSignal as fleetIsWeakSignal } from "../../fleet/security-checks.mjs";

/** Check ids whose evidence is public (an advisory one only while the result is advisory). Everything else is security. */
export const PUBLIC_CHECKS = new Set(Object.keys(CHECK_CLASS).filter((id) => CHECK_CLASS[id] === "public" || CHECK_CLASS[id] === "advisory"));

// Security checks whose "part" verdict can be a weak signal, not a finding: tool-poisoning's "weak indicators, none
// conclusive" and annotation-honesty's "only caches changed". The fleet file decides from the summary text; a part
// whose summary does not match is a finding (fail closed). Weak signals are shown in full, styled as a weak signal.
export const WEAK_PART = new Set(Object.keys(FLEET_WEAK_PART));

/** @typedef {{ id: string, critical?: boolean, advisory?: boolean, verdict?: string, summary?: string }} CheckLike */

/** @param {CheckLike} check */
export function isSecurityCheck(check) {
  if (check.critical === true) return true;
  const cls = CHECK_CLASS[check.id];
  return !(cls === "public" || (cls === "advisory" && check.advisory === true));
}

/** A part verdict on a security check that only hints at a problem (same rule as the owner notices). @param {CheckLike} check */
export function isWeakSignal(check) {
  return check.verdict === "part" && isSecurityCheck(check) && fleetIsWeakSignal({ ...check, advisory: false });
}

/** A security check whose verdict is a finding: fail, or part that is not a weak signal. @param {CheckLike} check */
export function isSecurityFinding(check) {
  if (!isSecurityCheck(check)) return false;
  return check.verdict === "fail" || (check.verdict === "part" && !isWeakSignal(check));
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
