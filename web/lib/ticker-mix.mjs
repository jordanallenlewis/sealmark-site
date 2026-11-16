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
