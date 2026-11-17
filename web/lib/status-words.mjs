// Status wording check used by scripts/home-check.mjs (rule 3), kept here so it has a unit test.

const WHITELIST = /table-preview|preview_table|preview tool/gi;
// A semver with a pre-release tag ("0.14.0-beta.2", "v1.2.3-rc.1+build5") is a version string, i.e. data about
// someone else's release, not our status wording.
const SEMVER_PRERELEASE = /\bv?\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z.-]+)?/g;

/**
 * The exact strings another party owns on a results page: server ids, package names, the name the server announced,
 * the versions tested and the tool names it declared. A page may print them anywhere (title, breadcrumb, headings,
 * neighbour links, check summaries), so the gate removes these exact strings instead of relying on every render site
 * carrying `data-third-party` (a "mock-server" or "2.0-beta.1" there is their data, never our status wording).
 * @param {Array<{ id?: string, name?: string, serverInfoName?: string | null, versionTested?: string | null, refTested?: string | null, tools?: Array<string | { name?: string }> }>} servers
 * @returns {string[]} longest first
 */
export function thirdPartyStrings(servers) {
  const out = new Set();
  for (const s of servers ?? []) {
    for (const v of [s.id, s.name, s.serverInfoName, s.versionTested, s.refTested]) if (typeof v === "string" && v.length >= 3) out.add(v);
    for (const t of s.tools ?? []) { const n = typeof t === "string" ? t : t?.name; if (typeof n === "string" && n.length >= 3) out.add(n); }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first banned status word in `text`, as `{ word, index, rest }` (index into `rest`), or null. `exempt`: exact strings to ignore (thirdPartyStrings). */
export function findStatusWord(text, { exempt = [] } = {}) {
  let t = text;
  // only strings that contain a banned word matter; whole-token matches, so "mock-server-2" is not cut inside "foo-mock-server-2x"
  const banned = /preview|concept|mock|beta/i;
  for (const e of exempt) if (banned.test(e)) t = t.replace(new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(e)}(?![A-Za-z0-9_-])`, "g"), " ");
  const rest = t
    .replace(WHITELIST, "")
    .replace(/\bno write concept\b/g, "") // the db pack's own verdict wording, quoted from reports
    .replace(SEMVER_PRERELEASE, " ");
  const m = /\bpreview\b|\bconcept\b|\bmock\b|\bbeta\b/i.exec(rest);
  return m ? { word: m[0], index: m.index, rest } : null;
}
