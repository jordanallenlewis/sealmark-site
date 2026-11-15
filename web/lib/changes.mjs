// "Since the last run" on a results page (site#54): what differs between the run the page shows and the graded run before
// it, from fleet/history.jsonl (grades per test area, versions) and fleet/telemetry.jsonl (tool counts). Facts only: it
// never says why a grade moved. A failed start is not a run to compare with (it says nothing about the grade).

const ORDER = ["F", "D", "C", "B", "A"];
const better = (a, b) => ORDER.indexOf(a) > ORDER.indexOf(b);

/**
 * @param runs  one server's runs, oldest first, one per date: { date, version, sealmark?, status: "ok"|"failed", packs }
 * @param testedAt  the date of the result the page shows
 * @param toolCounts  date -> tool count for graded runs (toolCountsFrom), optional
 * @returns null when the page's run is not a graded run in the history or no graded run came before it
 */
export function changeSinceLast(runs, testedAt, toolCounts = {}) {
  const at = runs.findIndex((r) => r.date === testedAt);
  if (at < 0 || runs[at].status !== "ok") return null;
  let prev = -1;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (runs[i].status === "ok") { prev = i; break; }
  }
  if (prev < 0) return null;
  const a = runs[prev];
  const b = runs[at];
  const items = [];
  if (a.version && b.version && a.version !== b.version) items.push({ kind: "version", from: a.version, to: b.version });
  if (a.sealmark && b.sealmark && a.sealmark !== b.sealmark) items.push({ kind: "sealmark", from: a.sealmark, to: b.sealmark });
  const was = a.packs ?? {};
  const now = b.packs ?? {};
  for (const pack of Object.keys(was)) {
    if (!(pack in now)) continue;
    if (was[pack] !== now[pack]) items.push({ kind: "grade", pack, from: was[pack], to: now[pack], dir: better(now[pack], was[pack]) ? "up" : "down" });
  }
  for (const pack of Object.keys(was)) if (!(pack in now)) items.push({ kind: "gone", pack, from: was[pack] });
  for (const pack of Object.keys(now)) if (!(pack in was)) items.push({ kind: "new", pack, to: now[pack] });
  const tFrom = toolCounts[a.date];
  const tTo = toolCounts[b.date];
  if (Number.isInteger(tFrom) && Number.isInteger(tTo) && tFrom !== tTo) items.push({ kind: "tools", from: tFrom, to: tTo, dir: tTo > tFrom ? "up" : "down" });
  return {
    from: { date: a.date, version: a.version, sealmark: a.sealmark },
    to: { date: b.date, version: b.version, sealmark: b.sealmark },
    failedBetween: runs.slice(prev + 1, at).filter((r) => r.status !== "ok").length,
    items,
    gradeChanged: items.some((i) => i.kind === "grade" || i.kind === "new" || i.kind === "gone"),
  };
}

/** date -> tool count of one server's graded runs in fleet/telemetry.jsonl (text). A later line for the same day wins. */
export function toolCountsFrom(text, id) {
  const out = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.id !== id || r.status !== "ok" || !Number.isInteger(r.toolCount)) continue;
    out[r.testedAt] = r.toolCount;
  }
  return out;
}
