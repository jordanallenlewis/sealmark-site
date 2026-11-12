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

// ---- the one GitHub issue opened per repository on a server's first grade (fleet/notify-owners.mjs) ----

export const ISSUE_MARKER = (id) => `<!-- sealmark-owner-notice:${id} -->`;
export const AUTHOR_URL = "https://github.com/jordanallenlewis";
export const METHODOLOGY_URL = `${ORIGIN}/docs/methodology/#grading-formula`;

const gradedPacks = (server) => (server.packs ?? []).filter((p) => p.status === "graded" && p.letter);
const areaName = (id) => PACK_LABEL[id] ?? id;
const article = (letter) => (letter === "A" || letter === "F" ? "an" : "a"); // "an A", "a B"

// Scored checks in graded test areas that did not fully pass (advisory, n/a and inconclusive are not scored).
export function notPassed(server) {
  const areas = new Set(gradedPacks(server).map((p) => p.id));
  return (server.checks ?? []).filter((c) => !c.advisory && areas.has(c.pack) && (c.verdict === "fail" || c.verdict === "part"));
}

// The paragraph under the first one. `listed` are the failing or partly passing checks the issue may name (the caller
// decides which are safe to name: fleet/security-checks.mjs); with none, every scored check must have passed.
export function issueReason({ server, listed = [] }) {
  const cov = server.coverage ?? {};
  const n = cov.toolsCalledValid ?? 0;
  const m = cov.toolsTotal ?? server.toolCount ?? 0;
  let text;
  if (!listed.length) {
    if (letterOf(server) !== "A" || notPassed(server).length) throw new Error(`${server.id}: the reason names no check, but not every scored check passed`);
    text = cov.level === "hygiene-only"
      ? `Every scored check passed. Only ${n} of ${m} tools could be called with default settings, so this grade covers the handshake and tool metadata only.`
      : `Every scored check passed. ${n} of ${m} tools answered a valid call.`;
  } else {
    const areas = gradedPacks(server).map((p) => `${areaName(p.id)} ${p.letter}`).join(", ");
    const bullets = listed.map((c) => `- \`${c.id}\`: ${String(c.summary ?? "").trim()} (${c.verdict === "fail" ? "failed" : "partly passed, half credit"})`).join("\n");
    text = `The grade is the lowest test-area grade (${areas}). It comes from:\n\n${bullets}`;
  }
  const provisional = gradedPacks(server).filter((p) => p.provisional).map((p) => areaName(p.id));
  if (provisional.length) text += `\n\nThe ${provisional.join(" and ")} grade is provisional: a check that could lower it did not finish in this run.`;
  return text;
}

// The reproduce line (`sealmark run --start "<command line>"`, checked against `sealmark run --help`).
export const reproduce = (server) => `npx -y sealmark@${server.sealmark?.version ?? "latest"} run --start "${server.launch}"`;

// The issue. `also` are other graded servers from the same repository, each already cleared to be named.
export function issueDraft({ id, server, repo, listed = [], also = [] }) {
  const letter = letterOf(server);
  const title = `Automated Sealmark test of ${server.name} ${server.versionTested}: ${letter}`;
  const links = [
    `- What was tested and what was not: ${resultsUrl(id)}`,
    `- How grades work: ${METHODOLOGY_URL}`,
    `- Reproduce it: \`${reproduce(server)}\``,
    ...also.map((x) => `- Also tested from this repository: \`${x.name}\` ${x.versionTested} got ${article(letterOf(x))} **${letterOf(x)}**: ${resultsUrl(x.id)}`),
  ].join("\n");
  const body = [
    ISSUE_MARKER(id),
    `Hi. [Sealmark](${ORIGIN}) is an open-source test suite for MCP servers, run by [Jordan Allen Lewis](${AUTHOR_URL}). An automated run started \`${server.name}\` ${server.versionTested} with \`${server.launch}\` on ${server.testedAt}. It got ${article(letter)} **${letter}**.`,
    issueReason({ server, listed }),
    links,
    `This is automated and can be wrong. If a result looks wrong, reply here and we will recheck it and correct the page. If you want the server taken off sealmark.dev, say so and we will remove it.`,
    `This is the only issue Sealmark will open here. Close it whenever you like.`,
  ].join("\n\n");
  return { repo, title, body };
}

