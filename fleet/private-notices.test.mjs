// node --test fleet/private-notices.test.mjs   Private email notices for held security findings. No network, no files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REMIND_DAYS, REPLY_DAYS, PUBLISH_DAYS, parseSecurityMd, emailFromNpm, emailFromPypi, resolveContact, renderNotice, recordReported } from "./private-notices.mjs";

const entry = {
  repo: "acme/widget-mcp",
  servers: [{ id: "widget", name: "widget-mcp", version: "1.2.0", testedAt: "2026-11-12", letter: "D", rerun: "npx -y sealmark@1.0.0 run --start \"npx -y widget-mcp@1.2.0\"", results: "https://sealmark.dev/results/widget/",
    security: [{ id: "net-loopback-ssrf", label: "Loopback requests", verdict: "fail", summary: "fetched http://127.0.0.1:PORT/" }], otherFailing: [] }],
};

test("parseSecurityMd takes a mailto or plain address and ignores noreply and example addresses", () => {
  assert.deepEqual(parseSecurityMd("Report to [us](mailto:sec@acme.io) or noreply@github.com or you@example.com").emails, ["sec@acme.io"]);
  assert.deepEqual(parseSecurityMd("Email security@acme.io.").emails, ["security@acme.io"]);
  assert.equal(parseSecurityMd("Use the Report a vulnerability button").emails.length, 0);
  assert.equal(parseSecurityMd(null).emails.length, 0);
});

test("package metadata: npm maintainers and author, PyPI author", () => {
  assert.equal(emailFromNpm({ maintainers: [{ name: "a", email: "m@acme.io" }] }), "m@acme.io");
  assert.equal(emailFromNpm({ author: { email: "x@acme.io" }, maintainers: [] }), "x@acme.io");
  assert.equal(emailFromNpm({ maintainers: [{ email: "a@users.noreply.github.com" }] }), null);
  assert.equal(emailFromPypi({ info: { author_email: "Jo <jo@acme.io>" } }), "jo@acme.io");
  assert.equal(emailFromPypi({ info: {} }), null);
});

test("parseSecurityMd ignores addresses in config examples and keeps lines about reporting", () => {
  const md = "Connect with postgres://user:pass@db.internal:5432/x\n\n## Reporting\nSend vulnerability reports to sec@acme.io\n\nDemo login admin@demo.local";
  assert.deepEqual(parseSecurityMd(md).emails, ["sec@acme.io"]);
  assert.equal(parseSecurityMd("Maintained by bob@acme.io, thanks").emails.length, 0, "an address on a line that is not about security is not a security contact");
});

test("a SECURITY.md with a link or advisory route but no address is the channel; no fallback to a package address", async () => {
  const get = fake({
    "https://api.github.com/repos/acme/w/contents/SECURITY.md": { text: "Report through GitHub private vulnerability reporting: https://github.com/acme/w/security/advisories/new" },
    "https://registry.npmjs.org/w/latest": { maintainers: [{ email: "old@acme.io" }] },
  });
  const c = await resolveContact({ repo: "acme/w", ecosystem: "npm", pkg: "w" }, { get });
  assert.deepEqual([c.channel, c.email], ["security-policy-link", null]);
});

const fake = (map) => async (url) => (url in map ? map[url] : { missing: true });

test("resolveContact order: SECURITY.md, then package maintainer, then public profile; never a commit email", async () => {
  const base = { repo: "acme/widget-mcp", ecosystem: "npm", pkg: "widget-mcp" };
  const profile = { "https://api.github.com/users/acme": { email: "owner@acme.io", type: "User" } };
  const npm = { "https://registry.npmjs.org/widget-mcp/latest": { maintainers: [{ email: "m@acme.io" }] } };
  const sec = { "https://api.github.com/repos/acme/widget-mcp/contents/SECURITY.md": { text: "Report vulnerabilities to sec@acme.io" } };
  let c = await resolveContact(base, { get: fake({ ...profile, ...npm, ...sec }) });
  assert.deepEqual([c.channel, c.email], ["security-policy", "sec@acme.io"]);
  c = await resolveContact(base, { get: fake({ ...profile, ...npm }) });
  assert.deepEqual([c.channel, c.email], ["package-maintainer", "m@acme.io"]);
  c = await resolveContact(base, { get: fake({ ...profile }) });
  assert.deepEqual([c.channel, c.email], ["github-profile", "owner@acme.io"]);
  c = await resolveContact(base, { get: fake({}) });
  assert.equal(c.channel, "none");
  assert.equal(c.email, null);
});

test("resolveContact records private vulnerability reporting separately from the email channel", async () => {
  const c = await resolveContact({ repo: "acme/w", ecosystem: "npm", pkg: "w" }, { get: fake({ "https://api.github.com/repos/acme/w/private-vulnerability-reporting": { enabled: true } }) });
  assert.equal(c.pvr, true);
  assert.equal(c.channel, "none");
});

test("renderNotice is plain text with the finding, repro, disclosure link, 14 days, one reminder, day 90, no tracking", () => {
  const { subject, text } = renderNotice({ entry, replyTo: "jordanallenlewis@sealmark.dev", today: "2026-11-14" });
  assert.match(subject, /widget-mcp/);
  assert.match(text, /Loopback requests/);
  assert.match(text, /npx -y sealmark@1\.0\.0 run --start/);
  assert.match(text, /https:\/\/sealmark\.dev\/disclosure\//);
  assert.match(text, new RegExp(`${REPLY_DAYS} days`));
  assert.match(text, /one reminder/);
  assert.match(text, new RegExp(`day ${PUBLISH_DAYS}`));
  assert.match(text, /jordanallenlewis@sealmark\.dev/);
  assert.doesNotMatch(text, /<[a-z]+[ >]/i);
  assert.doesNotMatch(text, /utm_|pixel|track(ing)? link/i);
  assert.equal(REMIND_DAYS < REPLY_DAYS, true);
});

test("recordReported sets every finding to reported with publishAfter at day 90 and logs the email in the ledger without the address", () => {
  const disclosure = { findings: { "widget/net-loopback-ssrf": { status: "pending-report", reportedAt: null, publishAfter: null }, "other/x": { status: "pending-report", reportedAt: null, publishAfter: null } } };
  const ledger = { issues: [], emails: [], replies: [] };
  const r = recordReported({ disclosure, ledger, entry, channel: "security-policy", today: "2026-11-14" });
  assert.deepEqual(r.disclosure.findings["widget/net-loopback-ssrf"], { status: "reported", reportedAt: "2026-11-14", publishAfter: "2027-02-12" });
  assert.equal(r.disclosure.findings["other/x"].status, "pending-report");
  assert.deepEqual(r.ledger.emails, [{ repo: "acme/widget-mcp", channel: "security-policy", at: "2026-11-14", remindAfter: "2026-11-21", replyBy: "2026-11-28" }]);
  assert.doesNotMatch(JSON.stringify(r), /@/);
  assert.equal(disclosure.findings["widget/net-loopback-ssrf"].status, "pending-report", "input untouched");
});
