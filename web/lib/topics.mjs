// "Best graded MCP servers for <topic>" pages (site#56). Which topic a server belongs to is decided by fixed rules on
// facts, never by a model and never by hand: a test area Sealmark graded on it, a keyword or topic its maintainers
// declared (npm or PyPI keywords, GitHub topics; fleet/server-facts.mjs keeps them in fleet/server-facts.json), or a
// whole word or phrase in its name. Descriptions are not used: a word in free text ("row level security", a badge URL
// with "github") put servers in topics they are not about (review on site#56). Every row says which rule put it there.
// Only servers with a grade are listed. Pure functions, no I/O: covered by lib/topics.test.mjs.

const RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/** A topic needs this many graded servers before it gets a page: a "best of" list of two says nothing. */
export const MIN_SERVERS = 5;

/**
 * slug, page title words, test areas that count as the topic, and terms. A term matches a declared keyword exactly or a
 * whole word or phrase in the name (hyphens, slashes and spaces are the same).
 * @type {{ id: string, title: string, areas: string[], terms: string[] }[]}
 */
export const TOPICS = [
  { id: "databases", title: "databases", areas: ["db", "sqlite"], terms: ["database", "databases", "postgres", "postgresql", "mysql", "mariadb", "sqlite", "sql", "mongodb", "redis", "supabase", "clickhouse", "duckdb", "bigquery", "snowflake"] },
  { id: "browser-automation", title: "browser automation and web scraping", areas: [], terms: ["browser automation", "playwright", "puppeteer", "web scraping", "scraping", "scraper", "crawler", "headless browser"] },
  { id: "payments-crypto", title: "payments and crypto", areas: [], terms: ["x402", "usdc", "stablecoin", "crypto", "cryptocurrency", "solana", "ethereum", "blockchain", "defi", "micropayments", "agent payments", "payments"] },
  { id: "finance", title: "finance and accounting", areas: [], terms: ["accounting", "bookkeeping", "invoicing", "finance", "financial data", "trading", "stocks", "stock market", "market data", "backtesting"] },
  { id: "documents", title: "documents and PDFs", areas: [], terms: ["pdf", "ocr", "docx", "spreadsheet", "excel", "documents"] },
  { id: "files", title: "files and file systems", areas: ["fs"], terms: ["filesystem", "file system", "file operations", "file sharing", "file transfer"] },
  { id: "git-devops", title: "Git, code and DevOps", areas: ["git"], terms: ["git", "github", "gitlab", "code review", "devops", "kubernetes", "docker", "terraform", "ci/cd"] },
  { id: "memory", title: "memory and knowledge", areas: [], terms: ["memory", "agent memory", "ai memory", "knowledge graph", "knowledge base", "rag", "embeddings", "vector database"] },
  { id: "search-seo", title: "web search and SEO", areas: [], terms: ["web search", "search engine", "serp", "seo", "llms.txt", "ai visibility"] },
  { id: "media", title: "images, video and speech", areas: [], terms: ["image generation", "video generation", "text to image", "image to video", "ai image generator", "ai video generator", "nano banana", "veo", "text to speech", "tts", "speech to text"] },
  { id: "security", title: "security", areas: [], terms: ["security", "prompt injection", "vulnerability", "vulnerabilities", "pentest", "pentesting", "threat intelligence"] },
  { id: "email-messaging", title: "email and messaging", areas: [], terms: ["email", "slack", "discord", "telegram", "sms", "whatsapp"] },
  { id: "monitoring", title: "monitoring and homelab", areas: [], terms: ["observability", "monitoring", "homelab", "uptime", "alerting", "prometheus", "grafana"] },
  { id: "maps-travel", title: "maps, travel and weather", areas: [], terms: ["maps", "google maps", "geocoding", "travel", "flights", "hotels", "weather"] },
  { id: "productivity", title: "calendars, tasks and notes", areas: [], terms: ["calendar", "todo", "notion", "jira", "trello", "project management", "obsidian"] },
];

// Lower case, every run of other characters one space, padded: " ci cd " matches "CI/CD", "ci-cd" and "ci cd", and a
// term only matches whole words (" sql " is not in " nosql ").
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * Why a server belongs to a topic, or null: the first rule that holds, in the order area, keyword, name.
 * @param {{ name: string, packs: { id: string, status: string, letter: string | null }[] }} server
 * @param {{ keywords?: string[] } | null | undefined} about
 * @param {{ areas: string[], terms: string[] }} topic
 * @returns {{ from: "area" | "keyword" | "name", term: string } | null}
 */
export function topicMatch(server, about, topic) {
  const area = topic.areas.find((a) => (server.packs ?? []).some((p) => p.id === a && p.status === "graded" && has(RANK, p.letter)));
  if (area) return { from: "area", term: area };
  const kws = Array.isArray(about?.keywords) ? about.keywords.filter((k) => typeof k === "string").map((k) => norm(k)) : [];
  const kw = topic.terms.find((t) => kws.includes(norm(t)));
  if (kw) return { from: "keyword", term: kw };
  const name = norm(server.name);
  const inName = topic.terms.find((t) => name.includes(norm(t)));
  return inName ? { from: "name", term: inName } : null;
}

const gradedPacks = (x) => (x.packs ?? []).filter((p) => p.status === "graded" && has(RANK, p.letter));

/** The server grade exactly as the rest of the site shows it (lib/results-shared.ts worst): the first of its lowest
 * graded test-area letters, provisional if that pack is; null when nothing was graded. */
export function grade(x) {
  if (x.gradeWithdrawn) return null;
  const g = gradedPacks(x);
  if (!g.length) return null;
  const w = g.reduce((a, b) => (RANK[b.letter] < RANK[a.letter] ? b : a));
  return { letter: w.letter, provisional: w.provisional === true };
}

/**
 * One topic page's rows, best first, in three tiers whatever the grade: 0 graded in the topic's own test area, 1 graded
 * in another test area beyond the protocol, 2 protocol only (hygiene: tools called only with invalid input, no
 * evidence about what they do). Within a tier: grade, then a firm grade before a provisional one, then more test areas
 * graded, then more valid tool calls, then name. Servers with no grade are never listed.
 * @template {{ id: string, name: string, testedAt: string, packs: { id: string, status: string, letter: string | null, provisional?: boolean }[], coverage?: { validCalls?: number } }} S
 * @param {S[]} servers
 * @param {Record<string, { about?: { keywords?: string[] } } | undefined>} facts by server id
 * @param {{ areas: string[], terms: string[] }} topic
 * @param {(x: S) => boolean} held the server has a finding under private disclosure
 */
export function topicRows(servers, facts, topic, held) {
  const rows = [];
  for (const x of servers) {
    const g = grade(x);
    if (!g) continue;
    const why = topicMatch(x, has(facts, x.id) ? facts[x.id]?.about : null, topic);
    if (!why) continue;
    const areas = gradedPacks(x).filter((p) => p.id !== "core").map((p) => p.id);
    const calls = Number.isInteger(x.coverage?.validCalls) && x.coverage.validCalls >= 0 ? x.coverage.validCalls : 0;
    const tier = why.from === "area" ? 0 : areas.length ? 1 : 2;
    rows.push({ id: x.id, name: x.name, testedAt: x.testedAt, letter: g.letter, provisional: g.provisional, held: held(x), areas, calls, why, tier });
  }
  return rows.sort((a, b) =>
    a.tier - b.tier || RANK[b.letter] - RANK[a.letter] || Number(a.provisional) - Number(b.provisional) || b.areas.length - a.areas.length || b.calls - a.calls || a.name.localeCompare(b.name, "en"));
}

/** Every topic with at least MIN_SERVERS graded servers, in TOPICS order, each with its rows. */
export function topicPages(servers, facts, held, topics = TOPICS) {
  return topics.map((t) => ({ ...t, rows: topicRows(servers, facts, t, held) })).filter((t) => t.rows.length >= MIN_SERVERS);
}

/** The words a row shows for why it is listed. */
export function whyText(why, areaLabel) {
  if (why.from === "area") return `graded in the ${areaLabel(why.term)} test area`;
  if (why.from === "keyword") return `declared keyword or topic “${why.term}”`;
  return `its name says “${why.term}”`;
}
