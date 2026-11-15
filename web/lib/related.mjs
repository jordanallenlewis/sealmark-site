// "Related servers" on a results page (site#55): other servers graded in the same specific test area. Protocol
// and Effects run on almost every server, so sharing only those relates nothing. Ranked by how many areas they
// share, then by the better overall grade, then by name. Grades only: no tool names, no check detail.
const BROAD = new Set(["core", "effects", "custom"]);
const RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };
const MAX = 5;

/** @param {{ packs: { id: string; status: string; letter: string | null; provisional?: boolean }[] }} s */
const areas = (s) => s.packs.filter((p) => p.status === "graded" && p.letter && !BROAD.has(p.id)).map((p) => p.id);
/** @param {{ packs: { id: string; status: string; letter: string | null; provisional?: boolean }[] }} s */
function worst(s) {
  const g = s.packs.filter((p) => p.status === "graded" && p.letter);
  return g.length ? g.reduce((a, b) => (RANK[b.letter] < RANK[a.letter] ? b : a)) : null;
}

/**
 * @template {{ id: string; name: string; packs: { id: string; status: string; letter: string | null; provisional?: boolean }[] }} S
 * @param {S} x
 * @param {S[]} all
 */
export function relatedServers(x, all) {
  const mine = new Set(areas(x));
  if (!mine.size) return [];
  return all
    .filter((y) => y.id !== x.id)
    .map((y) => {
      const w = worst(y);
      return { id: y.id, name: y.name, shared: areas(y).filter((a) => mine.has(a)), letter: w?.letter ?? null, provisional: !!w?.provisional };
    })
    .filter((y) => y.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || (RANK[b.letter] ?? -1) - (RANK[a.letter] ?? -1) || a.name.localeCompare(b.name, "en"))
    .slice(0, MAX);
}
