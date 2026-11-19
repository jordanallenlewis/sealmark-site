// Grade lookup: /data/v1/lookup.json maps what a person or an agent has in hand before installing an MCP server (an npm or
// PyPI package name, a GitHub repository URL, or a results id) to the graded servers it names, so the grade and the reasons
// behind it can be read from /data/v1/servers/<id>.json first (docs: /docs/guides/results-data, "Look up a server").
//
// Keys are `npm:<name>`, `pypi:<name>`, `github:<owner>/<repo>` and `id:<id>`, normalised as the functions below do and the
// guide spells out, so a client can build a key without this code. A key maps to a list of ids: one repository can hold
// several graded servers. A repository key comes only from the repository link the server's page shows (none while a
// security finding on it is reported privately, the page's rule). Pure functions, no I/O: lib/lookup.test.mjs;
// scripts/api-check.mjs rule 13 checks the built file against the list and the pages (lookupProblems).

export const LOOKUP_VERSION = "v1";

const NPM = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PYPI = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const REPO = /^[a-z0-9._-]{1,100}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `npm:<name>`: the scope stays, a version or tag after the name is dropped, lowercased. Null when it is not a package name. */
export function npmKey(input) {
  if (typeof input !== "string") return null;
  const m = input.trim().match(/^(@[^/@\s]+\/[^/@\s]+|[^/@\s]+)(?:@[^\s]*)?$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return name.length <= 214 && NPM.test(name) ? `npm:${name}` : null;
}

/** `pypi:<name>`: PEP 503 (lowercase, runs of `-`, `_` and `.` as one `-`), extras and version specifiers dropped. */
export function pypiKey(input) {
  if (typeof input !== "string") return null;
  const name = input.trim().split(/[\s[;=<>!~@]/)[0];
  return name && PYPI.test(name) ? `pypi:${name.replace(/[-_.]+/g, "-").toLowerCase()}` : null;
}

/**
 * `github:<owner>/<repo>`, lowercased (GitHub names are case-insensitive), from `owner/repo` or any common GitHub URL form:
 * https, `git+https`, `ssh://git@`, `git@github.com:`, with or without `.git`, `www.` or a path after the repository.
 */
export function githubKey(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^git\+/i, "");
  const m = s.match(/^(?:(?:https?|ssh|git):\/\/)?(?:git@)?(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i) ?? s.match(/^([^/\s:@]+)\/([^/\s#?:@]+)$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

/** `id:<id>`, the last part of the results page address, as it is (ids are file names). */
export function idKey(input) {
  return typeof input === "string" && ID.test(input.trim()) ? `id:${input.trim()}` : null;
}

/** The key of the package or repository a server was graded from. */
export function ecosystemKey(x) {
  if (x.ecosystem === "npm") return npmKey(x.name);
  if (x.ecosystem === "pypi") return pypiKey(x.name);
  if (x.ecosystem === "github") return githubKey(x.name);
  return null;
}

/**
 * The keys to try for what someone typed, most specific first: a prefixed key, an npmjs.com, pypi.org or GitHub URL, a scoped
 * npm name, `owner/repo`, or a bare name (an npm name, a PyPI name or an id).
 * @param {unknown} input
 * @returns {string[]}
 */
export function lookupKeys(input) {
  if (typeof input !== "string") return [];
  const s = input.trim();
  if (!s) return [];
  const pre = s.match(/^(npm|pypi|github|id):(.*)$/i);
  if (pre) {
    const kind = pre[1].toLowerCase();
    const k = kind === "npm" ? npmKey(pre[2]) : kind === "pypi" ? pypiKey(pre[2]) : kind === "github" ? githubKey(pre[2]) : idKey(pre[2]);
    return k ? [k] : [];
  }
  const npmUrl = s.match(/^(?:https?:\/\/)?(?:www\.)?npmjs\.(?:com|org)\/package\/(@[^/?#\s]+\/[^/?#\s]+|[^/?#@\s]+)/i);
  if (npmUrl) return [npmKey(decodeURIComponent(npmUrl[1]))].filter(Boolean);
  const pypiUrl = s.match(/^(?:https?:\/\/)?(?:www\.)?pypi\.org\/project\/([^/?#\s]+)/i);
  if (pypiUrl) return [pypiKey(pypiUrl[1])].filter(Boolean);
  if (/github\.com/i.test(s) || /^[^@][^/\s]*\/[^/\s]+$/.test(s)) return [githubKey(s)].filter(Boolean);
  if (s.startsWith("@")) return [npmKey(s)].filter(Boolean);
  return [npmKey(s), pypiKey(s), idKey(s)].filter(Boolean);
}

/**
 * The ids the first matching key names (none: not graded, or not by that name).
 * @param {{ keys?: Record<string, string[]> } | null | undefined} index the parsed lookup.json
 * @param {unknown} input
 */
export function resolveLookup(index, input) {
  const keys = index && typeof index.keys === "object" && index.keys ? index.keys : null;
  if (!keys) return [];
  for (const k of lookupKeys(input)) {
    if (Object.prototype.hasOwnProperty.call(keys, k) && Array.isArray(keys[k])) return keys[k];
  }
  return [];
}

/**
 * The lookup document.
 * @param {{ id: string, ecosystem: string, name: string, repo: string | null, testedAt: string }[]} servers the listed
 *   servers; `repo` is the `owner/repo` the server's page links, or null when it links none
 * @param {string} site absolute origin
 */
export function lookupIndex(servers, site) {
  /** @type {Map<string, Set<string>>} */
  const keys = new Map();
  const add = (k, id) => {
    if (!k) return;
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k).add(id);
  };
  for (const x of servers) {
    add(idKey(x.id), x.id);
    add(ecosystemKey(x), x.id);
    if (x.repo) add(githubKey(x.repo), x.id);
  }
  // `updated` is the newest test date, not the build time, so an unchanged index keeps its ETag across deploys.
  const updated = servers.reduce((m, x) => (x.testedAt > m ? x.testedAt : m), "") || null;
  const sorted = [...keys.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, ids]) => [k, [...ids].sort()]);
  return { version: LOOKUP_VERSION, updated, count: servers.length, server: `${site}/data/${LOOKUP_VERSION}/servers/{id}.json`, keys: Object.fromEntries(sorted) };
}

/**
 * What is wrong with a built lookup.json, compared with the list and the pages (api-check rule 13).
 * @param {any} index the parsed file
 * @param {{ id: string, ecosystem: string, name: string, held: boolean }[]} listed servers.json, with `held` recomputed
 *   from the raw data (a finding reported privately: the page shows no repository)
 * @param {(id: string, url: string) => boolean} pageLinks whether the server's page links that GitHub URL (lowercased)
 * @returns {string[]}
 */
export function lookupProblems(index, listed, pageLinks) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return ["lookup.json is not an object"];
  const out = [];
  const fields = Object.keys(index).sort().join(",");
  if (fields !== "count,keys,server,updated,version") out.push(`unexpected fields in lookup.json (${fields})`);
  if (index.count !== listed.length) out.push(`count ${index.count} but ${listed.length} servers listed`);
  const keys = index.keys && typeof index.keys === "object" && !Array.isArray(index.keys) ? index.keys : null;
  if (!keys) return [...out, "keys is not an object"];
  const ids = new Set(listed.map((s) => s.id));
  /** @type {Map<string, string[]>} id to the keys that name it */
  const byId = new Map();
  for (const [k, v] of Object.entries(keys)) {
    if (!/^(npm|pypi|github|id):/.test(k)) out.push(`${k}: unknown kind of key`);
    if (!Array.isArray(v) || !v.every((id) => typeof id === "string")) { out.push(`${k}: not a list of ids`); continue; }
    for (const id of v) {
      if (!ids.has(id)) { out.push(`${k} names ${id}, which is not a listed server`); continue; }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(k);
    }
  }
  const has = (k, id) => Object.prototype.hasOwnProperty.call(keys, k) && Array.isArray(keys[k]) && keys[k].includes(id);
  for (const s of listed) {
    const own = ecosystemKey(s);
    const idk = idKey(s.id);
    if (idk && !has(idk, s.id)) out.push(`${s.id}: not found by ${idk}`);
    if (own && !has(own, s.id)) out.push(`${s.id}: not found by ${own}`);
    for (const k of byId.get(s.id) ?? []) {
      if (k === own || k === idk) continue;
      if (s.held) out.push(`${s.id}: a server with a private finding is found by ${k}`);
      else if (!k.startsWith("github:")) out.push(`${s.id}: found by ${k}, which is not its id or its package`);
      else if (!pageLinks(s.id, `https://github.com/${k.slice("github:".length)}`)) out.push(`${s.id}: ${k} is not a repository its page links`);
    }
  }
  return out;
}
