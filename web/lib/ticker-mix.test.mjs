import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceGoodBad, goodBadRows, goodOrBad, spreadEvenly, twoEvenRows } from "./ticker-mix.mjs";

// The real mix on 2026-11-16: 159 A, 68 B, 2 C, 19 D, 11 F.
const mix = { A: 159, B: 68, C: 2, D: 19, F: 11 };
const items = Object.entries(mix).flatMap(([g, n]) => Array.from({ length: n }, (_, i) => ({ g, i })));

test("keeps every item exactly once", () => {
  const out = spreadEvenly(items, (x) => x.g);
  assert.equal(out.length, items.length);
  assert.equal(new Set(out).size, items.length);
});

// The biggest grade (A) fills the places the others leave, so only the other grades are held to even spacing.
test("each grade but the biggest is evenly spaced along the whole line", () => {
  const out = spreadEvenly(items, (x) => x.g);
  for (const [g, n] of Object.entries(mix).filter(([g]) => g !== "A")) {
    const at = out.flatMap((x, i) => (x.g === g ? [i] : []));
    const ideal = out.length / n;
    // Gaps between neighbours, the loop seam included, stay within 3 places (or a tenth of the gap) of the ideal spacing.
    const gaps = at.map((p, k) => (k + 1 < at.length ? at[k + 1] - p : at[0] + out.length - p));
    for (const gap of gaps) assert.ok(Math.abs(gap - ideal) <= Math.max(3, ideal / 10), `${g}: gap ${gap}, ideal ${ideal.toFixed(1)}`);
  }
});

test("both rows carry the same mix of grades", () => {
  const [r1, r2] = twoEvenRows(items, (x) => x.g);
  for (const [g, n] of Object.entries(mix)) {
    const a = r1.filter((x) => x.g === g).length, b = r2.filter((x) => x.g === g).length;
    assert.ok(Math.abs(a - b) <= 1, `${g}: ${a} vs ${b} of ${n}`);
  }
});

test("each row spaces its grades evenly too, and rare grades never sit side by side", () => {
  for (const out of twoEvenRows(items, (x) => x.g)) {
    const n = {}; for (const x of out) n[x.g] = (n[x.g] ?? 0) + 1;
    for (const [g, c] of Object.entries(n).filter(([g]) => g !== "A")) {
      const at = out.flatMap((x, i) => (x.g === g ? [i] : []));
      const gaps = at.map((p, k) => (k + 1 < at.length ? at[k + 1] - p : at[0] + out.length - p));
      for (const gap of gaps) assert.ok(Math.abs(gap - out.length / c) <= Math.max(3, out.length / c / 10), `row ${g}: gap ${gap}`);
    }
    for (let i = 0; i < out.length; i++) {
      const a = out[i].g, b = out[(i + 1) % out.length].g;
      if (a !== "A" && a !== "B") assert.notEqual(a, b, `two ${a} in a row at ${i}`);
    }
  }
});

test("good and bad grades come out even, and every bad one is kept", () => {
  const out = balanceGoodBad(items, (x) => x.g);
  const good = out.filter((x) => x.g === "A" || x.g === "B").length;
  const bad = out.filter((x) => "CDF".includes(x.g)).length;
  assert.equal(bad, mix.C + mix.D + mix.F);
  assert.equal(good, bad);
  assert.equal(new Set(out).size, out.length);
  const a = out.filter((x) => x.g === "A").length, b = out.filter((x) => x.g === "B").length;
  assert.ok(Math.abs(a - b) <= 1, `A ${a} vs B ${b}`);
});

test("the balanced list still splits into two evenly spaced rows", () => {
  const [r1, r2] = goodBadRows(balanceGoodBad(items, (x) => x.g), (x) => x.g);
  const bad = (r) => r.filter((x) => "CDF".includes(x.g)).length;
  assert.ok(Math.abs(bad(r1) - bad(r2)) <= 1);
  // Good and bad alternate, so two bad ones never sit side by side, and the same letter never repeats back to back
  // among the bad ones (C, D, F vary along the row).
  for (const r of [r1, r2]) {
    for (let i = 0; i < r.length; i++) assert.notEqual(goodOrBad(r[i].g), goodOrBad(r[(i + 1) % r.length].g), `two ${goodOrBad(r[i].g)} side by side at ${i}`);
  }
});
