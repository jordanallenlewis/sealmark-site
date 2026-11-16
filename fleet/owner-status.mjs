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

/** Every check the notice named passes in a graded re-test that is newer than the notice. */
function namedChecksPass(notice, server) {
  const named = notice.failing ?? [];
  if (!named.length || !server || !letterOf(server)) return false;
  if (!server.testedAt || server.testedAt <= notice.at) return false;
  if (failedSince(server)) return false; // the latest attempt did not finish: no claim either way
  return named.every((id) => (server.checks ?? []).find((c) => c.id === id)?.verdict === "pass");
}

/**
 * @param {{notice: object, issue: {state: string, closed_at?: string|null}|null, comments: object[], server: object|undefined}} a
 * @returns {null | {state: "none"|"replied"|"closed"|"fixed", noticedAt: string, issueUrl: string, repliedAt: string|null, closedAt: string|null, stillFailing: boolean, retestedAt: string|null}}
 */
export function ownerStatus({ notice, issue, comments, server }) {
  if (!issue || !notice?.url) return null;
  const replies = (comments ?? []).filter((c) => isOwnerComment(c, notice.author));
  const closed = issue.state === "closed";
  const fixed = namedChecksPass(notice, server);
  const stillFailing = !fixed && (notice.failing ?? []).length > 0 && Boolean(server);
  return {
    state: fixed ? "fixed" : closed ? "closed" : replies.length ? "replied" : "none",
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
    for (const id of [n.id, ...(n.also ?? [])]) {
      const now = computed.get(n.url);
      const entry = now ?? previous?.notices?.[id];
      if (entry) notices[id] = entry;
    }
  }
  return { updated: today, notices: Object.fromEntries(Object.entries(notices).sort(([a], [b]) => a.localeCompare(b))) };
}
