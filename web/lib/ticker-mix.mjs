// Order for the home page ticker (Jordan, 2026-11-16: "an even mix of each grade and evenly spaces them apart").
// Each grade is split evenly between the two rows, then each row spreads its grades evenly along its length, in
// proportion to how many servers have each grade, so no stretch of either row is all one grade.

/**
 * Spread groups evenly along a line, in proportion to their size. The rarest group claims its ideal places first
 * (item k of n at (k + 0.5) * N / n), then each bigger group takes the free place nearest each of its ideal places,
 * and the biggest group fills what is left. A group of n among N items lands about every N / n places, and the
 * spacing holds across a looping ticker's seam too (the first and last items sit half a gap from the ends).
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} groupOf
 * @returns {T[]}
 */
export function spreadEvenly(items, groupOf) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const it of items) {
    const g = groupOf(it);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const N = items.length;
  /** @type {(T | undefined)[]} */
  const slots = new Array(N).fill(undefined);
  const free = (/** @type {number} */ i) => i >= 0 && i < N && slots[i] === undefined;
  for (const list of [...groups.values()].sort((x, y) => x.length - y.length)) {
    list.forEach((it, k) => {
      const ideal = Math.min(N - 1, Math.floor(((k + 0.5) * N) / list.length));
      for (let d = 0; d < N; d++) {
        if (free(ideal + d)) { slots[ideal + d] = it; return; }
        if (free(ideal - d)) { slots[ideal - d] = it; return; }
      }
    });
  }
  return /** @type {T[]} */ (slots);
}

/**
 * Two ticker rows with the same mix: each group's items are dealt alternately to the rows, then each row is spread.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} groupOf
 * @returns {[T[], T[]]}
 */
export function twoEvenRows(items, groupOf) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {[T[], T[]]} */
  const rows = [[], []];
  for (const it of items) {
    const g = groupOf(it);
    const k = seen.get(g) ?? 0;
    seen.set(g, k + 1);
    rows[k % 2].push(it);
  }
  return [spreadEvenly(rows[0], groupOf), spreadEvenly(rows[1], groupOf)];
}

/**
 * An even mix of good and bad grades (Jordan, 2026-11-16: "show an even mix of good and bad grades"). Every bad grade
 * (C, D, F) is kept; the good ones (A, B) are cut to the same number, split evenly between A and B, each picked at even
 * steps through its own list so the picks spread across the alphabet instead of coming from the top. Ungraded servers
 * are left out.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string | undefined} letterOf
 * @returns {T[]}
 */
export function balanceGoodBad(items, letterOf) {
  const of = (/** @type {string[]} */ ls) => items.filter((x) => ls.includes(letterOf(x) ?? ""));
  const bad = of(["C", "D", "F"]);
  const a = of(["A"]), b = of(["B"]);
  const wantB = Math.min(b.length, Math.floor(bad.length / 2));
  const wantA = Math.min(a.length, bad.length - wantB);
  /** @type {(list: T[], n: number) => T[]} */
  const pick = (list, n) => Array.from({ length: n }, (_, k) => list[Math.floor(((k + 0.5) * list.length) / n)]);
  return [...pick(a, wantA), ...pick(b, wantB), ...bad];
}

/** "good" for A and B, "bad" for C, D and F: the grouping the ticker alternates on. @param {string | undefined} letter */
export const goodOrBad = (letter) => (letter === "A" || letter === "B" ? "good" : "bad");

/**
 * The ticker's two rows: every letter split evenly between the rows, then in each row good and bad alternate, with
 * the letters on each side spread evenly (A and B take turns among the good, C, D and F among the bad).
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string | undefined} letterOf
 * @returns {[T[], T[]]}
 */
export function goodBadRows(items, letterOf) {
  const L = (/** @type {T} */ x) => letterOf(x) ?? "";
  /** @type {[T[], T[]]} */
  const rows = [[], []];
  // Each side (good, bad) is spread by letter, then dealt to the rows in an A-B-B-A pattern: each row gets half of
  // the side (within one), and the letters alternate instead of one row taking every A and the other every B.
  for (const side of ["good", "bad"]) {
    spreadEvenly(items.filter((x) => goodOrBad(L(x)) === side), L).forEach((it, k) => rows[k % 4 === 0 || k % 4 === 3 ? 0 : 1].push(it));
  }
  /** @type {(row: T[]) => T[]} */
  const order = (row) => {
    const good = spreadEvenly(row.filter((x) => goodOrBad(L(x)) === "good"), L);
    const bad = spreadEvenly(row.filter((x) => goodOrBad(L(x)) === "bad"), L);
    return spreadEvenly([...good, ...bad], (x) => goodOrBad(L(x)));
  };
  return [order(rows[0]), order(rows[1])];
}
