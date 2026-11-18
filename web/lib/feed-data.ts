// Server-only: the Atom feeds of grade changes (site#59, lib/feed.mjs), built from fleet/history.jsonl through
// lib/api.mjs changesDoc, with the results pages' own redactions.
import { changesDoc } from "@/lib/api.mjs";
import { atomFeed, changeEntry, feedChanges } from "@/lib/feed.mjs";
import { loadHistory, type ServerHistory } from "@/lib/history";
import { PACK_LABEL, RESULTS_PUBLIC, SERVERS_RESULTS, redactionsFor } from "@/lib/results";
import { ORIGIN } from "@/lib/seo";

/** Newest changes in the site-wide feed. */
export const FEED_LIMIT = 50;
const label = (p: string) => PACK_LABEL[p] ?? p;
const isHeld = (id: string) => {
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  return !x || redactionsFor(x).size > 0;
};
const stamp = (day: string | null | undefined) => `${day || "1970-01-01"}T00:00:00Z`;

function changesOf(histories: ServerHistory[]) {
  const doc = changesDoc(histories, ORIGIN, Number.MAX_SAFE_INTEGER);
  return { changes: feedChanges(doc.changes, isHeld), updated: doc.updated as string | null };
}

export function allChangesFeed() {
  const { changes, updated } = changesOf(RESULTS_PUBLIC ? loadHistory() : []);
  const self = `${ORIGIN}/results/feed.xml`;
  return atomFeed({
    id: self, self, page: `${ORIGIN}/results/history/`,
    title: "Sealmark: MCP server grade changes",
    subtitle: "A server's overall grade moved with a new server version, tested with the same Sealmark version as the run before. Moves that came with a Sealmark upgrade are left out.",
    updated: stamp(changes[0]?.date ?? updated),
    entries: changes.slice(0, FEED_LIMIT).map((c) => changeEntry(c, label)),
  });
}

export function serverFeed(id: string) {
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  const h = loadHistory().find((v) => v.id === id);
  const { changes } = changesOf(h ? [h] : []);
  const self = `${ORIGIN}/results/${id}/feed.xml`;
  return atomFeed({
    id: self, self, page: `${ORIGIN}/results/${id}/`,
    title: `Sealmark: grade changes for ${x?.name || id}`,
    updated: stamp(changes[0]?.date ?? x?.testedAt),
    entries: changes.map((c) => changeEntry(c, label)),
  });
}

export const atomResponse = (xml: string) => new Response(xml, { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
