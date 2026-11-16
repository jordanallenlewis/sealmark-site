import test from "node:test";
import assert from "node:assert/strict";
import { dayWords, ownerNotice } from "./owner-notice.mjs";
import { findStatusWord } from "./status-words.mjs";

const URL_ = "https://github.com/o/r/issues/3";
const base = { noticedAt: "2026-11-14", issueUrl: URL_, repliedAt: null, closedAt: null, stillFailing: false, retestedAt: null };

test("dayWords", () => {
  assert.equal(dayWords("2026-11-04"), "4 Nov 2026");
  assert.equal(dayWords("2026-11-04T09:00:00Z"), "4 Nov 2026");
  assert.equal(dayWords(null), null);
  assert.equal(dayWords("2026-13-01"), null);
});
test("each state has its own label, the issue link and a dated sentence", () => {
  const none = ownerNotice({ ...base, state: "none" });
  assert.equal(none.label, "No reply yet");
  assert.match(none.text, /opened a public issue .* on 14 Nov 2026/);
  assert.match(none.text, /A reply is optional\./);
  assert.equal(none.issueUrl, URL_);
  assert.match(ownerNotice({ ...base, state: "replied", repliedAt: "2026-11-15" }).text, /A maintainer replied on 15 Nov 2026\./);
  assert.equal(ownerNotice({ ...base, state: "fixed", retestedAt: "2026-11-16" }).label, "Re-test passes");
  assert.match(ownerNotice({ ...base, state: "fixed", retestedAt: "2026-11-16" }).text, /pass in a later re-test, run on 16 Nov 2026/);
  const closed = ownerNotice({ ...base, state: "closed", closedAt: "2026-11-17", stillFailing: true });
  assert.match(closed.text, /closed on 17 Nov 2026\. The latest re-test still shows a check it named as failing/);
  assert.doesNotMatch(ownerNotice({ ...base, state: "closed", closedAt: "2026-11-17" }).text, /still shows/);
});
test("a reply stays visible after a close or a fix", () => {
  assert.match(ownerNotice({ ...base, state: "closed", closedAt: "2026-11-17", repliedAt: "2026-11-15" }).text, /replied on 15 Nov 2026/);
  assert.match(ownerNotice({ ...base, state: "fixed", retestedAt: "2026-11-17", repliedAt: "2026-11-15" }).text, /replied on 15 Nov 2026/);
});
test("nothing shows without a valid public issue link or a known state", () => {
  assert.equal(ownerNotice(undefined), null);
  assert.equal(ownerNotice({ ...base, state: "none", issueUrl: "javascript:alert(1)" }), null);
  assert.equal(ownerNotice({ ...base, state: "none", issueUrl: "https://example.com/o/r/issues/3" }), null);
  assert.equal(ownerNotice({ ...base, state: "weird" }), null);
});
test("neutral wording: no blame words, no status wording", () => {
  for (const state of ["none", "replied", "fixed", "closed"]) {
    const t = ownerNotice({ ...base, state, repliedAt: "2026-11-15", closedAt: "2026-11-17", retestedAt: "2026-11-17", stillFailing: true });
    assert.doesNotMatch(t.text + t.label, /ignor|unresponsive|failed to respond|didn't|did not respond|silent/i);
    assert.equal(findStatusWord(t.text + " " + t.label), null);
  }
});
