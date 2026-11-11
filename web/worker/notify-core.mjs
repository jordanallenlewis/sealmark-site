// Pure logic shared by the notify Worker (web/worker/index.js), the build step that writes its grade table
// (web/scripts/notify-grades.mjs) and the fleet's owner-notice and impact scripts (fleet/notify-owners.mjs,
// fleet/impact.mjs). No I/O here, so node --test can cover it (fleet/notify.test.mjs).

export const ORIGIN = "https://sealmark.dev";
export const FROM = { email: "grades@notify.sealmark.dev", name: "Sealmark" };
export const REPLY_TO = "jordanallenlewis@sealmark.dev";

export const RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };
const PACK_LABEL = { core: "Protocol", db: "Database", sqlite: "SQLite", fs: "Files", git: "Git", net: "Network", http: "HTTP", effects: "Effects", exec: "Commands", custom: "Custom" };

// The server's one letter: the worst graded pack, as the results table and the badge colour show it. Null when no
// pack was graded (the server failed to start, or every pack was n/a).
export function letterOf(server) {
  const graded = (server.packs ?? []).filter((p) => p.status === "graded" && p.letter);
  if (!graded.length) return null;
  return graded.reduce((a, b) => (RANK[b.letter] < RANK[a.letter] ? b : a)).letter;
}

// Ids of the checks that failed outright (advisory checks never count against the grade, so they are left out).
export function failingChecks(server) {
  return (server.checks ?? []).filter((c) => c.verdict === "fail" && !c.advisory).map((c) => c.id);
}

// Whether the server has a badge at /badge/<id>.svg (the one rule; web/lib/seo.ts serverBadge uses it too): standard
// settings, not opted out, at least one graded pack beyond the protocol pack, and no provisional pack grade.
export function badgeEligible(server) {
  if (server.standard !== true || server.badge?.eligible === false) return false;
  const graded = (server.packs ?? []).filter((p) => p.status === "graded" && p.letter);
  return graded.some((p) => p.id !== "core") && !graded.some((p) => p.provisional);
}

// The compact row the Worker bundles per server (web/worker/grades.json).
export function gradeRow(server) {
  const checks = Object.fromEntries((server.checks ?? []).map((c) => [c.id, c.label]));
  const packs = (server.packs ?? []).filter((p) => p.status === "graded" && p.letter).map((p) => ({ id: p.id, letter: p.letter }));
  return { name: server.name, version: server.versionTested, testedAt: server.testedAt, letter: letterOf(server), packs, failing: failingChecks(server), labels: checks, badge: badgeEligible(server) };
}

// What moved between the last notified state and now. `prev` is {letter, failing[]} or null (never recorded).
// Returns null when nothing should be sent: first sighting (recorded as the baseline; subscribers saw the grade in
// their confirm email), no current letter (a failed run says nothing about the grade), or the same letter.
export function gradeChange(prev, cur) {
  if (!cur || !cur.letter) return null;
  if (!prev || !prev.letter) return null;
  if (prev.letter === cur.letter) return null;
  const before = new Set(prev.failing ?? []);
  const after = new Set(cur.failing ?? []);
  return {
    from: prev.letter,
    to: cur.letter,
    direction: RANK[cur.letter] > RANK[prev.letter] ? "up" : "down",
    fixed: [...before].filter((id) => !after.has(id)),
    broke: [...after].filter((id) => !before.has(id)),
  };
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const resultsUrl = (id) => `${ORIGIN}/results/${encodeURIComponent(id)}/`;
const badgeUrl = (id) => `${ORIGIN}/badge/${encodeURIComponent(id)}.svg`;
const packLine = (row) => row.packs.map((p) => `${PACK_LABEL[p.id] ?? p.id} ${p.letter}`).join(", ");

// One plain HTML wrapper for both emails: paragraphs, one link per line, no images or tracking.
function html(paras, footer) {
  const body = paras.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join("");
  return `<!doctype html><html><body style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:20px">${body}<p style="margin:24px 0 0;font-size:13px;color:#666">${footer}</p></body></html>`;
}

// The double opt-in email. Nothing else is sent to an address until this link is opened.
export function confirmEmail({ id, row, confirmUrl }) {
  const subject = `Confirm Sealmark grade alerts for ${row.name}`;
  const text = [
    `Someone (we hope you) asked for an email when the Sealmark grade of ${row.name} changes.`,
    `Its grade now: ${row.letter ?? "not graded"} (${packLine(row) || "no pack graded"}), version ${row.version}, tested ${row.testedAt}.`,
    `Confirm: ${confirmUrl}`,
    `If you did not ask for this, ignore this email. Nothing more is sent unless the link is opened.`,
    `Results: ${resultsUrl(id)}`,
  ].join("\n\n");
  const htmlBody = html(
    [
      `Someone (we hope you) asked for an email when the Sealmark grade of <b>${esc(row.name)}</b> changes.`,
      `Its grade now: <b>${esc(row.letter ?? "not graded")}</b> (${esc(packLine(row) || "no pack graded")}), version ${esc(row.version)}, tested ${esc(row.testedAt)}.`,
      `<a href="${esc(confirmUrl)}">Confirm grade alerts</a>`,
      `If you did not ask for this, ignore this email. Nothing more is sent unless the link is opened.`,
    ],
    `<a href="${esc(resultsUrl(id))}">Results for ${esc(row.name)}</a>`,
  );
  return { subject, text, html: htmlBody };
}

// The one email a confirmed subscriber gets when the letter moves.
export function changeEmail({ id, row, change, unsubscribeUrl }) {
  const verb = change.direction === "up" ? "went up" : "went down";
  const subject = `Sealmark: ${row.name} ${verb} from ${change.from} to ${change.to}`;
  const name = (cid) => `${cid} (${row.labels?.[cid] ?? "check"})`;
  const lines = [
    `The Sealmark grade of ${row.name} ${verb}: ${change.from} to ${change.to}, version ${row.version}, tested ${row.testedAt}.`,
    `By pack: ${packLine(row)}.`,
  ];
  if (change.fixed.length) lines.push(`Now passing: ${change.fixed.map(name).join("; ")}.`);
  if (change.broke.length) lines.push(`Now failing: ${change.broke.map(name).join("; ")}.`);
  const links = [`Full results: ${resultsUrl(id)}`, ...(row.badge ? [`Badge: ${badgeUrl(id)}`] : [])];
  const text = [...lines, ...links, `Stop these emails: ${unsubscribeUrl}`].join("\n\n");
  const htmlBody = html(
    lines.map(esc).concat([`<a href="${esc(resultsUrl(id))}">Full results</a>${row.badge ? ` · <a href="${esc(badgeUrl(id))}">Badge</a>` : ""}`]),
    `Automated re-test, not checked by hand. <a href="${esc(unsubscribeUrl)}">Stop these emails</a>.`,
  );
  return { subject, text, html: htmlBody };
}

// The one GitHub issue opened per repo on a server's first grade (fleet/notify-owners.mjs).
export const ISSUE_MARKER = (id) => `<!-- sealmark-owner-notice:${id} -->`;
export function issueDraft({ id, server, repo }) {
  const letter = letterOf(server);
  const failing = (server.checks ?? []).filter((c) => c.verdict === "fail" && !c.advisory);
  const graded = (server.packs ?? []).filter((p) => p.status === "graded" && p.letter);
  const title = `Sealmark graded ${server.name} ${server.versionTested}: ${letter}`;
  const rows = graded.map((p) => `| ${PACK_LABEL[p.id] ?? p.id} | ${p.letter} | ${p.points}/${p.scored} |`).join("\n");
  const top = failing.slice(0, 5).map((c) => `- \`${c.id}\` ${c.label}: ${c.summary}`).join("\n");
  const body = [
    ISSUE_MARKER(id),
    `Hi! [Sealmark](${ORIGIN}) is an open-source behavioural test suite for MCP servers. It started \`${server.name}\` ${server.versionTested} with its default settings on ${server.testedAt} and graded it **${letter}**.`,
    `| Pack | Grade | Points |\n|---|---|---|\n${rows}`,
    failing.length ? `Checks that failed:\n\n${top}${failing.length > 5 ? `\n- and ${failing.length - 5} more on the results page` : ""}` : `No check failed outright.`,
    `Full results, with what was and was not covered: ${resultsUrl(id)}`,
    `This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.`,
    ...(badgeEligible(server) ? [`Badge, if you want one (it links to the results and updates with each re-test):\n\n\`\`\`md\n[![Sealmark](${badgeUrl(id)})](${resultsUrl(id)})\n\`\`\``] : []),
    `The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.`,
  ].join("\n\n");
  return { repo, title, body };
}
