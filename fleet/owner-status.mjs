// What the public server page shows about a Sealmark owner issue: no reply yet, a maintainer replied, the checks named
// in the issue now pass, or the issue was closed. Pure functions; fleet/notify-owners.mjs feeds them the GitHub data it
// already reads every run and writes fleet/owner-status.json, which the site reads at build time (web/lib/owner-notice.ts).
//
// Facts only. A reply is a comment by the repository's owner, a member or a collaborator (GitHub's own
// author_association), never by a bot, never by Sealmark's own account, never by a passer-by. The file names no person:
// states, dates and the public issue link.
import { failedSince } from "../web/lib/retest.mjs";
import { letterOf } from "../web/worker/notify-core.mjs";

export const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const day = (d) => (typeof d === "string" && d ? d.slice(0, 10) : null);

/** A comment by the repository's owner or a maintainer: not a bot, not the account that opened the notice. */
export function isOwnerComment(c, author) {
  const login = c?.user?.login;
  if (!login || c.user.type === "Bot" || /\[bot\]$/i.test(login)) return false;
  if (author && login.toLowerCase() === String(author).toLowerCase()) return false;
  return MAINTAINER.has(c.author_association);
}

/** The latest graded result is newer than the notice and its latest attempt finished: the only kind of result that can say anything about a fix. */
function currentResult(notice, server) {
  if (!notice.at || !server || !letterOf(server)) return false;
  if (!server.testedAt || server.testedAt <= notice.at) return false;
  return !failedSince(server); // a re-test that did not finish: no claim either way
}
const verdictOf = (server, id) => (server.checks ?? []).find((c) => c.id === id)?.verdict;

/**
 * `notice.named` is the ids of the checks the issue listed (fleet/notify-owners.mjs baseline). A notice without it
 * (older ledger lines) never claims a fix or a failure.
 * @param {{notice: object, issue: {state: string, closed_at?: string|null}|null, comments: object[], server: object|undefined}} a
 * @returns {null | {state: "none"|"replied"|"closed"|"fixed", noticedAt: string, issueUrl: string, repliedAt: string|null, closedAt: string|null, stillFailing: boolean, retestedAt: string|null}}
 */
export function ownerStatus({ notice, issue, comments, server }) {
  if (!issue || !notice?.url) return null;
  const replies = (comments ?? []).filter((c) => isOwnerComment(c, notice.author));
  // A person commented but GitHub does not class them as owner, member or collaborator (a private organisation member
  // is shown to an outside account as a contributor or nobody): we cannot tell, so "no reply yet" would be a guess.
  const unclassed = (comments ?? []).some((c) => c?.user?.login && c.user.type !== "Bot" && !/\[bot\]$/i.test(c.user.login) && c.user.login.toLowerCase() !== String(notice.author ?? "").toLowerCase() && !MAINTAINER.has(c.author_association));
  const closed = issue.state === "closed";
  const named = Array.isArray(notice.named) ? notice.named : [];
  const current = named.length > 0 && currentResult(notice, server);
  const fixed = current && named.every((id) => verdictOf(server, id) === "pass");
  const stillFailing = current && named.some((id) => verdictOf(server, id) === "fail");
  const state = fixed ? "fixed" : closed ? "closed" : replies.length ? "replied" : "none";
  if (state === "none" && unclassed) return null;
  return {
    state,
    noticedAt: notice.at,
    issueUrl: notice.url,
    repliedAt: replies.length ? day(replies.map((c) => c.created_at).filter(Boolean).sort()[0]) : null,
    closedAt: closed ? day(issue.closed_at) : null,
    stillFailing,
    retestedAt: fixed ? server.testedAt : null,
  };
}

/**
 * The committed file. One entry per server id a notice covers; a notice whose lookup failed this run keeps its last
 * entry (a failed call is not "no reply").
 * @param {{ledgerIssues: object[], computed: Map<string, object|null>, previous?: {notices?: object}, today: string}} a
 */
export function statusFile({ ledgerIssues, computed, previous, today }) {
  const notices = {};
  for (const n of ledgerIssues) {
    if (!n.url || !n.id) continue;
    const now = computed.get(n.url);
    for (const id of [n.id, ...(n.also ?? [])]) {
      // The re-test claims (fixed, still failing) were worked out from the server the notice is about only: a sibling
      // server in the same repository gets the reply and close facts, never those.
      const own = id === n.id;
      const sibling = now && (now.state === "fixed" ? { ...now, state: now.closedAt ? "closed" : now.repliedAt ? "replied" : "none", retestedAt: null } : now);
      const entry = (own ? now : sibling && { ...sibling, stillFailing: false }) ?? previous?.notices?.[id];
      if (entry) notices[id] = entry;
    }
  }
  return { updated: today, notices: Object.fromEntries(Object.entries(notices).sort(([a], [b]) => a.localeCompare(b))) };
}
