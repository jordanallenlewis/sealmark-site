import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRun, runRecord } from "./runs.mjs";

test("run record: time plus counts, nothing for a run that merged no reports", () => {
  assert.deepEqual(runRecord("2026-11-18T15:20:00.000Z", { graded: 40, failed: 12, added: 2 }), { at: "2026-11-18T15:20:00.000Z", graded: 40, failed: 12, new: 2 });
  assert.deepEqual(runRecord("2026-11-18T15:20:00.000Z", { graded: 1, failed: 0, added: 0 }, "schedule"), { at: "2026-11-18T15:20:00.000Z", event: "schedule", graded: 1, failed: 0, new: 0 });
  assert.equal(runRecord("2026-11-18T15:20:00.000Z", { graded: 1, failed: 0, added: 0 }, "x\ny").event, undefined, "only a plain event name is kept");
  assert.equal(runRecord("2026-11-18T15:20:00.000Z", { graded: 0, failed: 0, added: 0 }), null, "a run with no reports is not a run that recorded results");
  assert.equal(runRecord("not a time", { graded: 1, failed: 0, added: 0 }), null);
  assert.equal(runRecord("2026-11-18T15:20:00.000Z", { graded: -1, failed: 0, added: 0 }), null);
});

test("append run: one JSON line, file created when missing, null writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runs-"));
  const file = path.join(dir, "runs.jsonl");
  appendRun(file, null);
  assert.equal(fs.existsSync(file), false);
  appendRun(file, runRecord("2026-11-18T15:20:00.000Z", { graded: 1, failed: 2, added: 0 }));
  appendRun(file, runRecord("2026-11-18T21:20:00.000Z", { graded: 3, failed: 0, added: 1 }));
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.at), ["2026-11-18T15:20:00.000Z", "2026-11-18T21:20:00.000Z"]);
  fs.rmSync(dir, { recursive: true });
});
