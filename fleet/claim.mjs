// A maintainer's claim on a server: a small file committed in the server's own GitHub repository, read once a day by
// the facts lookup (fleet/server-facts.mjs) with the workflow's own GITHUB_TOKEN. No login, no account, no secret.
//
//   .github/sealmark-claim.json   {"sealmark": "claim/1", "servers": ["<sealmark id>", ...], "issues": "on"|"off", "retest": "YYYY-MM-DD"}
//
// The claim holds only when the file sits in the repository the package itself names today (npm `repository`; PyPI
// Source/Repository URLs; the repository a GitHub server starts from), that repository is the one the fleet linked to
// the server and not a fork, and the file names the server's id. Homepage and bug-tracker links never count. The
// repository's numeric id is pinned the first time the link holds (`pin`, kept on every later outcome, error or 404):
// when the linked name answers with another id (deleted and taken by someone else, or the old name reused after a
// rename) the server is never claimed again by any file; a maintainer emails to have the pin reset. Everything in the file is someone else's text: a strict shape, a size cap, and nothing shown but the
// matched id, the enumerated setting and a date parsed here. A claim changes no grade, badge or ranking.
// Design and threat model: sealmark-site#69. Covered by fleet/claim.test.mjs.
import { parseRepo, repoFromLaunch } from "./repo-url.mjs";

export const CLAIM_PATH = ".github/sealmark-claim.json";
export const MAX_BYTES = 2048;
export const MAX_SERVERS = 20;
const VERSION = "claim/1";
const KEYS = new Set(["sealmark", "servers", "issues", "retest"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// PyPI project URL labels that name the source repository. "Homepage" and the like are not proof: a package can point
// its homepage at a framework or SDK repository it does not maintain.
const PYPI_SOURCE = new Set(["source", "source code", "repository", "code", "github"]);

const bad = (why) => ({ ok: false, why });
const realDate = (s) => typeof s === "string" && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * The claim file from the GitHub contents API answer: {ok: true, servers, issues, retest} or {ok: false, why}.
 * why: not-file | too-big | encoding | not-json | shape | unknown-key | version | servers | issues | retest
 */
export function parseClaim(contents) {
  if (!contents || typeof contents !== "object" || Array.isArray(contents) || contents.type !== "file") return bad("not-file");
  if (!Number.isInteger(contents.size) || contents.size < 0 || contents.size > MAX_BYTES) return bad("too-big");
  if (contents.encoding !== "base64" || typeof contents.content !== "string") return bad("encoding");
  const bytes = Buffer.from(contents.content, "base64");
  if (bytes.length > MAX_BYTES) return bad("too-big");
  let doc;
  try { doc = JSON.parse(bytes.toString("utf8")); } catch { return bad("not-json"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return bad("shape");
  // JSON.parse makes "__proto__" an own key, so it is caught here like any other unknown key
  for (const k of Object.keys(doc)) if (!KEYS.has(k)) return bad("unknown-key");
  if (doc.sealmark !== VERSION) return bad("version");
  const s = doc.servers;
  if (!Array.isArray(s) || s.length < 1 || s.length > MAX_SERVERS || !s.every((x) => typeof x === "string" && ID.test(x))) return bad("servers");
  if (doc.issues !== undefined && doc.issues !== "on" && doc.issues !== "off") return bad("issues");
  if (doc.retest !== undefined && !realDate(doc.retest)) return bad("retest");
  return { ok: true, servers: [...new Set(s)], issues: doc.issues ?? "on", retest: doc.retest ?? null };
}

/**
 * The repository a claim may come from, read from the package's current metadata (npm: the latest version's manifest;
 * PyPI: `info`), or the repository a GitHub server is started from. Null when there is none of those.
 */
export function claimLink(server, meta) {
  if (server?.ecosystem === "github") return repoFromLaunch(server.launch) ?? parseRepo(`github:${server.name}`);
  if (server?.ecosystem === "npm") {
    const r = meta?.repository;
    return parseRepo(typeof r === "string" ? r : r?.url);
  }
  if (server?.ecosystem === "pypi") {
    const urls = meta?.project_urls;
    if (!urls || typeof urls !== "object") return null;
    for (const [k, v] of Object.entries(urls)) {
      if (PYPI_SOURCE.has(String(k).trim().toLowerCase())) { const r = parseRepo(v); if (r) return r; }
    }
    return null;
  }
  return null;
}

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Whether this server is claimed today: {claim, outcome, pin}. claim is the entry stored in server-facts.json, or null;
 * pin is the repository id to keep on the entry (null until the link first holds; once set, returned on every path).
 *   stored: the repository the fleet linked to the server (fleet/owner-repos.json); link: claimLink() for today;
 *   repoObj: GET /repos/{stored} (follows renames); pinned: the entry's last pin.
 * Throws when the file cannot be read (the caller keeps the last state and pin). outcome is a count for the run log:
 *   claimed | none | not-named | invalid | no-link | link-differs | fork | repository-changed
 */
export async function checkClaim({ server, stored, link, repoObj, api, today, pinned = null }) {
  const pin = Number.isInteger(pinned) ? pinned : null;
  const id = Number.isInteger(repoObj?.id) && !repoObj.missing ? repoObj.id : null;
  // the pin first: no later outcome may clear it, or a 404 day would let the next owner of the name claim
  if (pin !== null && id !== null && id !== pin) return { claim: { ended: "repository-changed", repoId: pin, checkedAt: today }, outcome: "repository-changed", pin };
  if (!stored || !link || id === null || typeof repoObj.full_name !== "string") return { claim: null, outcome: "no-link", pin };
  if (!same(link, stored) && !same(link, repoObj.full_name)) return { claim: null, outcome: "link-differs", pin };
  if (repoObj.fork === true) return { claim: null, outcome: "fork", pin };
  const file = await api(`/repos/${repoObj.full_name}/contents/${CLAIM_PATH}`);
  if (file?.missing) return { claim: null, outcome: "none", pin: id };
  const p = parseClaim(file);
  if (!p.ok) return { claim: null, outcome: "invalid", pin: id };
  if (!p.servers.includes(server.id)) return { claim: null, outcome: "not-named", pin: id };
  return {
    claim: { repo: repoObj.full_name, repoId: id, checkedAt: today, issues: p.issues, ...(p.retest ? { retest: p.retest } : {}) },
    outcome: "claimed",
    pin: id,
  };
}
