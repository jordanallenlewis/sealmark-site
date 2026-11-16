// The words for the owner-notice block on a server page (state from fleet/owner-status.json, written by
// fleet/owner-status.mjs). Facts only: what the public issue says happened, never a judgement of the owner, no name.
// Pure; covered by lib/owner-notice.test.mjs.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-14" -> "14 Nov 2026" (the date as written, no time zone arithmetic). */
export function dayWords(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ""));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/**
 * @param {{state: string, noticedAt?: string, issueUrl?: string, repliedAt?: string|null, closedAt?: string|null, stillFailing?: boolean, retestedAt?: string|null}|undefined} e
 * @returns {null | {state: string, label: string, text: string, issueUrl: string}}
 */
export function ownerNotice(e) {
  if (!e || !e.issueUrl || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(e.issueUrl)) return null;
  const sent = dayWords(e.noticedAt);
  const intro = `Sealmark opened a public issue on this project's repository${sent ? ` on ${sent}` : ""} to share this grade.`;
  const replied = dayWords(e.repliedAt);
  const closed = dayWords(e.closedAt);
  const retested = dayWords(e.retestedAt);
  switch (e.state) {
    case "fixed":
      return { state: "fixed", label: "Re-test passes", issueUrl: e.issueUrl, text: `${intro} The checks it named pass in a later re-test${retested ? `, run on ${retested}` : ""}.${replied ? ` A maintainer replied on ${replied}.` : ""}` };
    case "closed":
      return { state: "closed", label: "Issue closed", issueUrl: e.issueUrl, text: `${intro} The issue was closed${closed ? ` on ${closed}` : ""}.${e.stillFailing ? " The latest re-test still shows a check it named as failing." : ""}${replied ? ` A maintainer replied on ${replied}.` : ""}` };
    case "replied":
      return { state: "replied", label: "Maintainer replied", issueUrl: e.issueUrl, text: `${intro} A maintainer replied${replied ? ` on ${replied}` : ""}.` };
    case "none":
      return { state: "none", label: "No reply yet", issueUrl: e.issueUrl, text: `${intro} No reply yet. A reply is optional.` };
    default:
      return null;
  }
}
