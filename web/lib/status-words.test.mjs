import test from "node:test";
import assert from "node:assert/strict";
import { findStatusWord } from "./status-words.mjs";

test("semver pre-release tags are data, not status wording", () => {
  for (const t of ["version 0.14.0-beta.2", "v1.0.0-beta", "1.2.3-rc.1+build5 graded", "telbase 0.14.0-beta.2 and 2.0.0-preview.3", "1.0.0-mock.1"]) {
    assert.equal(findStatusWord(t), null, t);
  }
});

test("status wording is still caught", () => {
  for (const t of ["This is a beta", "early preview", "mock data", "a concept", "beta-2", "version beta", "0.14-beta.2", "1.0.0 beta"]) {
    assert.ok(findStatusWord(t), t);
  }
  assert.equal(findStatusWord("see 0.14.0-beta.2, now in beta").word, "beta");
});

test("existing exemptions hold", () => {
  assert.equal(findStatusWord("table-preview and preview_table, the preview tool, no write concept"), null);
});
