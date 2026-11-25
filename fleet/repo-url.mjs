// GitHub repository names from URLs and launch lines. Shared by the owner step (notify-owners.mjs) and the claim check
// (claim.mjs), so the claim check never imports the owner step.

// owner/repo from any GitHub URL or npm-style shorthand; null when it is not GitHub.
export function parseRepo(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i) ?? s.match(/^(?:github:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

// The repo named in a launch line (github ecosystem): `npx -y github:o/r`, `uvx --from git+https://github.com/o/r x`.
export function repoFromLaunch(launch) {
  for (const tok of String(launch ?? "").split(/\s+/)) {
    if (/^github:|github\.com/i.test(tok)) {
      const r = parseRepo(tok.replace(/^git\+/, ""));
      if (r) return r;
    }
  }
  return null;
}
