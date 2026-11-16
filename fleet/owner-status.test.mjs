import test from "node:test";
import assert from "node:assert/strict";
import { ownerStatus, statusFile, isOwnerComment } from "./owner-status.mjs";

const notice = { id: "srv", also: ["srv-b"], repo: "o/r", at: "2026-11-14", number: 3, url: "https://github.com/o/r/issues/3", author: "sealmark-bot", failing: ["robust-input"] };
const open = { state: "open", closed_at: null };
const com = (login, assoc, over = {}) => ({ id: Math.random(), user: { login, type: "User" }, author_association: assoc, created_at: "2026-11-15T10:00:00Z", ...over });
const server = (verdict, over = {}) => ({ id: "srv", testedAt: "2026-11-16", packs: [{ id: "core", status: "graded", letter: "A" }], checks: [{ id: "robust-input", verdict }], ...over });
const st = (o) => ownerStatus({ notice, issue: open, comments: [], server: server("fail"), ...o });

test("no human comment: none", () => {
  assert.equal(st({}).state, "none");
  assert.equal(st({}).issueUrl, notice.url);
});
test("bots, Sealmark's own comments and drive-by users are not a reply", () => {
  const c = [com("sealmark-bot", "NONE"), com("dependabot[bot]", "NONE", { user: { login: "dependabot[bot]", type: "Bot" } }), com("rando", "NONE"), com("fan", "CONTRIBUTOR")];
  assert.equal(st({ comments: c }).state, "none");
});
test("owner, member or collaborator comment is a reply, with its date", () => {
  for (const a of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    const r = st({ comments: [com("maint", a)] });
    assert.equal(r.state, "replied");
    assert.equal(r.repliedAt, "2026-11-15");
  }
});
test("the bot's own login in any case is not a reply", () => {
  assert.equal(st({ comments: [com("Sealmark-Bot", "OWNER")] }).state, "none");
});
test("closed, checks still failing: closed", () => {
  const r = st({ issue: { state: "closed", closed_at: "2026-11-17T09:00:00Z" } });
  assert.equal(r.state, "closed");
  assert.equal(r.closedAt, "2026-11-17");
  assert.equal(r.stillFailing, true);
});
test("every named check passes in a re-test after the notice: fixed, even when open", () => {
  assert.equal(st({ server: server("pass") }).state, "fixed");
  assert.equal(st({ server: server("pass"), issue: { state: "closed", closed_at: "2026-11-17T09:00:00Z" } }).state, "fixed");
});
test("fixed needs a re-test after the notice, a graded run, a clean latest attempt and no failing named check", () => {
  assert.notEqual(st({ server: server("pass", { testedAt: "2026-11-14" }) }).state, "fixed");
  assert.notEqual(st({ server: server("part") }).state, "fixed");
  assert.notEqual(st({ server: server("pass", { packs: [] }) }).state, "fixed");
  assert.notEqual(st({ server: server("pass", { lastAttempt: { date: "2026-11-17", status: "failed", kind: "start-fail" } }) }).state, "fixed");
  assert.notEqual(st({ server: { ...server("pass"), checks: [] } }).state, "fixed");
});
test("a notice with no failing checks (an A) is never fixed, and a close is just closed", () => {
  const r = ownerStatus({ notice: { ...notice, failing: [] }, issue: { state: "closed", closed_at: "2026-11-15T00:00:00Z" }, comments: [], server: server("pass") });
  assert.equal(r.state, "closed");
  assert.equal(r.stillFailing, false);
});
test("a missing issue gives null so the previous status is kept", () => {
  assert.equal(ownerStatus({ notice, issue: null, comments: [], server: server("fail") }), null);
});
test("isOwnerComment", () => {
  assert.equal(isOwnerComment(com("m", "OWNER"), "sealmark-bot"), true);
  assert.equal(isOwnerComment(com("m", "OWNER", { user: null }), "sealmark-bot"), false);
});
test("statusFile keys every id of a notice, keeps old entries when a lookup failed, and carries no person", () => {
  const prev = { notices: { srv: { state: "replied", noticedAt: "2026-11-14", issueUrl: notice.url, repliedAt: "2026-11-15" } } };
  const f = statusFile({ ledgerIssues: [notice], computed: new Map([[notice.url, null]]), previous: prev, today: "2026-11-16" });
  assert.equal(f.notices.srv.state, "replied");
  assert.equal(f.notices["srv-b"], undefined);
  const g = statusFile({ ledgerIssues: [notice], computed: new Map([[notice.url, st({})]]), previous: prev, today: "2026-11-16" });
  assert.deepEqual(Object.keys(g.notices).sort(), ["srv", "srv-b"]);
  assert.equal(g.notices["srv-b"].state, "none");
  assert.ok(!JSON.stringify(g).includes("maint"));
  assert.equal(g.updated, "2026-11-16");
});
