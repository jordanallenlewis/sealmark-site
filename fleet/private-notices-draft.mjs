// node fleet/private-notices-draft.mjs <private-dir>
// Reads <private-dir>/owner-private-queue.json (written by notify-owners.mjs, gitignored), finds each contact and
// writes <private-dir>/private-notices.json and private-notices.md. It sends nothing. <private-dir> must be outside
// this repository: never commit what it writes (findings about other people's servers, their addresses).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { resolveContact, renderNotice } from "./private-notices.mjs";

const REPLY_TO = "jordanallenlewis@sealmark.dev";
const dir = resolve(process.argv[2] ?? "");
const root = resolve(import.meta.dirname, "..");
const rel = relative(root, dir);
if (!process.argv[2] || (!rel.startsWith("..") && !isAbsolute(rel))) { console.error("usage: private-notices-draft.mjs <private-dir outside the repository>"); process.exit(2); }

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
async function get(url) {
  const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "sealmark-notices", ...(token && url.startsWith("https://api.github.com") ? { authorization: `Bearer ${token}` } : {}) } });
  if (res.status === 404 || res.status === 204 && url.endsWith("private-vulnerability-reporting")) return { missing: true };
  if (!res.ok) return { missing: true };
  const j = await res.json();
  if (url.includes("/contents/") && j.content) return { text: Buffer.from(j.content, "base64").toString("utf8") };
  return j;
}

const queue = JSON.parse(readFileSync(resolve(dir, "owner-private-queue.json"), "utf8"));
const results = JSON.parse(readFileSync(resolve(root, "web/content/data/server-results.json"), "utf8")).servers;
const byId = new Map(results.map((s) => [s.id, s]));
const out = [];
for (const entry of queue.entries) {
  const s = byId.get(entry.servers[0]?.id);
  const contact = await resolveContact({ repo: entry.repo, ecosystem: s?.ecosystem, pkg: s?.name }, { get });
  const hasFinding = entry.servers.some((x) => x.security.length);
  const stale = entry.servers.filter((x) => !x.fresh).map((x) => x.id);
  const weak = entry.servers.flatMap((x) => x.security).every((c) => c.verdict === "part");
  out.push({ repo: entry.repo, ids: entry.servers.map((x) => x.id), contact, hasFinding, stale, onlyPart: weak, notice: renderNotice({ entry, replyTo: REPLY_TO }), entry });
}
writeFileSync(resolve(dir, "private-notices.json"), JSON.stringify(out, null, 2));
writeFileSync(resolve(dir, "private-notices.md"), out.map((o) => `## ${o.repo ?? o.ids.join(", ")}\nchannel: ${o.contact.channel}${o.contact.email ? ` (${o.contact.email})` : ""}; PVR: ${o.contact.pvr}; stale: ${o.stale.join(",") || "none"}; only partial: ${o.onlyPart}\nSubject: ${o.notice.subject}\n\n${o.notice.text}`).join("\n---\n\n"));
const n = (f) => out.filter(f).length;
console.log(`entries ${out.length}; email ${n((o) => o.contact.email)}; no email ${n((o) => !o.contact.email)}; pvr ${n((o) => o.contact.pvr)}; stale ${n((o) => o.stale.length)}; no finding ${n((o) => !o.hasFinding)}`);
