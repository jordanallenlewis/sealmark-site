// Topic pages' data (site#56): the published servers and their package keywords and description from
// fleet/server-facts.json (written by the fleet, fleet/server-facts.mjs), read at build time. A missing or unreadable
// facts file leaves only the test-area rule.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { topicPages, type About, type Topic, type TopicRow } from "@/lib/topics.mjs";
import { SERVERS_RESULTS, redactionsFor } from "@/lib/results";

let pages: (Topic & { rows: TopicRow[] })[] | undefined;
export function allTopicPages() {
  if (!pages) {
    let facts: Record<string, { about?: About } | undefined> = {};
    try { facts = (JSON.parse(readFileSync(resolve(process.cwd(), "..", "fleet", "server-facts.json"), "utf8")) as { servers?: typeof facts }).servers ?? {}; }
    catch { facts = {}; }
    pages = topicPages(SERVERS_RESULTS, facts, (x) => redactionsFor(x).size > 0);
  }
  return pages;
}
export const topicTitle = (t: Pick<Topic, "title">) => `Best graded MCP servers for ${t.title}`;
