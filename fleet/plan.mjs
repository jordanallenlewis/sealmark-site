// Plans a fleet run: which tracked MCP servers to re-test, plus a few new ones
// from the MCP Registry. Writes fleet-plan.json and, on GitHub Actions, a
// matrix output.
//
// Run from the repository root: node fleet/plan.mjs
// Env: GITHUB_TOKEN (optional; github ecosystem), FORCE_ALL (1 = re-test everything), MAX_NEW (default 10),
//      MAX_JOBS (default 40), STALE_DAYS (default 7).

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const FORCE_ALL = process.env.FORCE_ALL === "1";
const MAX_NEW = process.env.MAX_NEW ? Number(process.env.MAX_NEW) : 10;
const MAX_JOBS = process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : 40;
const STALE_DAYS = process.env.STALE_DAYS ? Number(process.env.STALE_DAYS) : 7;
const EXCLUDE = process.env.FLEET_EXCLUDE ? new RegExp(process.env.FLEET_EXCLUDE, "i") : null;

// JSON file, or fallback when it is missing or unparseable.
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Latest published version of a package, or null on any error.
async function latestVersion(ecosystem, name) {
  try {
    if (ecosystem === "npm") {
      // Encode "/" as %2F for scoped names, keeping the leading "@".
      const url = "https://registry.npmjs.org/" + name.replace(/\//g, "%2F") + "/latest";
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()).version ?? null;
    }
    if (ecosystem === "pypi") {
      const res = await fetch("https://pypi.org/pypi/" + name + "/json");
      if (!res.ok) return null;
      return (await res.json()).info?.version ?? null;
    }
    if (ecosystem === "github") {
      // name is "owner/repo"; newest release, else newest tag. Leading "v" dropped.
      const headers = { accept: "application/vnd.github+json" };
      if (process.env.GITHUB_TOKEN) headers.authorization = "Bearer " + process.env.GITHUB_TOKEN;
      const rel = await fetch("https://api.github.com/repos/" + name + "/releases/latest", { headers });
      if (rel.ok) {
        const tag = (await rel.json()).tag_name;
        if (tag) return String(tag).replace(/^v/, "");
      }
      const tags = await fetch("https://api.github.com/repos/" + name + "/tags?per_page=1", { headers });
      if (!tags.ok) return null;
      const t = (await tags.json())[0]?.name;
      return t ? String(t).replace(/^v/, "") : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Pin the package in a launch command to version, keeping the existing
// separator. Returns launch unchanged if the name cannot be pinned.
function pinLaunch(launch, name, ecosystem, version) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pinned = new RegExp(escaped + "(@|==)[A-Za-z0-9._-]+");
  if (pinned.test(launch)) {
    return launch.replace(pinned, (match, sep) => name + sep + version);
  }
  const tokens = launch.split(/\s+/);
  const idx = tokens.indexOf(name);
  if (idx !== -1) {
    tokens[idx] = name + (ecosystem === "npm" ? "@" : "==") + version;
    return tokens.join(" ");
  }
  return launch;
}

// GitHub API GET with the optional token; null on any error.
async function ghGet(path, raw = false) {
  try {
    const headers = { accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = "Bearer " + process.env.GITHUB_TOKEN;
    const res = await fetch("https://api.github.com/" + path, { headers });
    if (!res.ok) return null;
    return raw ? await res.text() : await res.json();
  } catch {
    return null;
  }
}

// owner/repo from a registry repository entry, or null when it is not on GitHub.
function githubRepo(server) {
  const url = server.repository?.url ?? "";
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] + "/" + m[2] : null;
}

// Launch command for a GitHub-hosted server, found from the repo's own files; null when none is clear.
async function githubLaunch(repo, sub) {
  const base = "repos/" + repo + "/contents/" + (sub ? sub.replace(/^\/+|\/+$/g, "") + "/" : "");
  const pkgText = await ghGet(base + "package.json", true);
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      if (pkg.bin && !sub) return "npx -y github:" + repo;
    } catch {}
  }
  const py = await ghGet(base + "pyproject.toml", true);
  if (py && !sub) {
    const sect = /\[project\.scripts\]\s*\n([\s\S]*?)(?:\n\[|$)/.exec(py);
    const script = sect && /^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=/m.exec(sect[1]);
    if (script) return "uvx --from git+https://github.com/" + repo + " " + script[1];
  }
  return null;
}

// Official registry servers we do not track yet. Pages through the whole registry until maxNew are found
// (capped at 150 pages, 5 minutes). npm and PyPI packages first; otherwise a GitHub-hosted repo whose
// own files say how to start it.
async function discover(knownIds, maxNew) {
  const found = [];
  const started = Date.now();
  let cursor = null;
  let probes = 0;
  for (let page = 0; page < 150 && found.length < maxNew && Date.now() - started < 300000; page++) {
    const url =
      "https://registry.modelcontextprotocol.io/v0/servers?limit=100" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.servers ?? []) {
      const server = item.server;
      if (!server) continue;
      if (item._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest !== true) continue;
      if (EXCLUDE && EXCLUDE.test(server.name ?? "")) continue;
      let pkg = null;
      let hasOtherPkg = false;
      for (const p of server.packages ?? []) {
        if (p.registryType !== "npm" && p.registryType !== "pypi") {
          hasOtherPkg = true;
          continue;
        }
        if (p.transport?.type !== "stdio") continue;
        if ((p.environmentVariables ?? []).some((e) => e.isRequired === true)) continue;
        if ((p.packageArguments ?? []).some((a) => a.isRequired === true)) continue;
        pkg = p;
        break;
      }
      if (pkg) {
        if (EXCLUDE && EXCLUDE.test(pkg.identifier ?? "")) continue;
        const id = pkg.identifier
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!id || knownIds.has(id)) continue;
        knownIds.add(id);
        found.push({
          id,
          name: pkg.identifier,
          ecosystem: pkg.registryType,
          launch:
            pkg.registryType === "npm"
              ? "npx -y " + pkg.identifier + "@" + pkg.version
              : "uvx " + pkg.identifier + "==" + pkg.version,
          version: pkg.version,
          isNew: true,
        });
        if (found.length >= maxNew) break;
        continue;
      }
      // GitHub-hosted: no usable npm/pypi stdio package, no required config, a repo at the root.
      if (hasOtherPkg || (server.remotes ?? []).length > 0 || (server.packages ?? []).length > 0) continue;
      const repo = githubRepo(server);
      if (!repo || probes >= 60) continue;
      if (EXCLUDE && EXCLUDE.test(repo)) continue;
      const id = repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id || knownIds.has(id) || knownIds.has(repo.split("/")[1].toLowerCase())) continue;
      probes++;
      const launch = await githubLaunch(repo, server.repository?.subfolder);
      if (!launch) continue;
      knownIds.add(id);
      found.push({
        id,
        name: repo,
        ecosystem: "github",
        launch,
        version: await latestVersion("github", repo),
        isNew: true,
      });
      if (found.length >= maxNew) break;
    }
    cursor = data.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }
  return found;
}

async function main() {
  const results = readJson("web/content/data/server-results.json", { servers: [] });
  const discovered = readJson("fleet/discovered.json", []);
  const overrides = readJson("fleet/overrides.json", {});

  // Tracked set; discovered first so the results file wins on duplicate id.
  const byId = new Map();
  for (const s of discovered) if (s?.id) byId.set(s.id, s);
  for (const s of results.servers ?? []) if (s?.id) byId.set(s.id, s);
  const tracked = [...byId.values()];

  for (const s of tracked) {
    if (typeof overrides[s.id] === "string") s.launch = overrides[s.id];
  }

  // Latest Sealmark release: every grade records the Sealmark version that made it,
  // and a new release makes every server due again.
  const sealmarkLatest = await latestVersion("npm", "sealmark");

  const jobs = [];
  for (const s of tracked) {
    const launch = s.launch ?? "";
    if (launch.includes("<workspace>")) continue;
    const v = await latestVersion(s.ecosystem, s.name);
    let due = FORCE_ALL;
    // GitHub-only servers compare the release or tag they were tested at (refTested).
    const tested = s.ecosystem === "github" ? s.refTested : s.versionTested;
    if (!due && v && v !== tested) due = true;
    if (!due && sealmarkLatest && s.sealmark?.version !== sealmarkLatest) due = true;
    if (!due && !s.testedAt) due = true;
    if (!due && s.testedAt) {
      const days = (Date.now() - Date.parse(s.testedAt)) / 86400000;
      if (Number.isFinite(days) && days >= STALE_DAYS) due = true;
    }
    if (!due) continue;
    jobs.push({
      id: s.id,
      name: s.name,
      ecosystem: s.ecosystem,
      launch: v && s.ecosystem !== "github" ? pinLaunch(launch, s.name, s.ecosystem, v) : launch,
      version: v || s.versionTested || null,
      isNew: false,
    });
  }

  // Oldest results first; keep room for MAX_NEW new servers so a Sealmark release cannot crowd them out.
  const age = new Map(tracked.map((s) => [s.id, Date.parse(s.testedAt ?? "") || 0]));
  jobs.sort((a, b) => (age.get(a.id) ?? 0) - (age.get(b.id) ?? 0));
  jobs.length = Math.min(jobs.length, Math.max(0, MAX_JOBS - MAX_NEW));
  jobs.push(...(await discover(new Set(tracked.map((s) => s.id)), MAX_NEW)));
  jobs.length = Math.min(jobs.length, MAX_JOBS);

  const plan = { generatedAt: new Date().toISOString(), jobs };
  writeFileSync("fleet-plan.json", JSON.stringify(plan, null, 2) + "\n");

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include: jobs }) + "\n");
    appendFileSync(process.env.GITHUB_OUTPUT, "count=" + jobs.length + "\n");
  }

  for (const j of jobs) {
    console.log(j.id + " " + (j.version ?? "-") + " " + (j.isNew ? "new" : "retest"));
  }
  console.log("planned " + jobs.length + " job(s)");
}

main().catch((err) => {
  console.error("plan.mjs: " + err.message);
  process.exit(1);
});
