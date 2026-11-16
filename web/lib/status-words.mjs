// Status wording check used by scripts/home-check.mjs (rule 3), kept here so it has a unit test.

const WHITELIST = /table-preview|preview_table|preview tool/gi;
// A semver with a pre-release tag ("0.14.0-beta.2", "v1.2.3-rc.1+build5") is a version string, i.e. data about
// someone else's release, not our status wording.
const SEMVER_PRERELEASE = /\bv?\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z.-]+)?/g;

/** The first banned status word in `text`, as `{ word, index, rest }` (index into `rest`), or null. */
export function findStatusWord(text) {
  const rest = text
    .replace(WHITELIST, "")
    .replace(/\bno write concept\b/g, "") // the db pack's own verdict wording, quoted from reports
    .replace(SEMVER_PRERELEASE, " ");
  const m = /\bpreview\b|\bconcept\b|\bmock\b|\bbeta\b/i.exec(rest);
  return m ? { word: m[0], index: m.index, rest } : null;
}
