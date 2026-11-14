// Plans a fleet run: which tracked MCP servers to re-test, plus a few new ones
// from the MCP Registry. Writes fleet-plan.json and, on GitHub Actions, a
// matrix output.
//
// Run from the repository root: node fleet/plan.mjs
// Env: GITHUB_TOKEN (optional; github ecosystem), FORCE_ALL (1 = re-test every tracked server: none is dropped to
//      make room for new tries, which only fill what is left up to MAX_JOBS), MAX_NEW (default 10),
//      MAX_JOBS (default 200, or 256 with FORCE_ALL; a GitHub matrix holds at most 256), STALE_DAYS (default 7),
//      TARGET_TOTAL (default 360: below this many tracked servers a run grows the set by GROW_NEW, default 60,
//      instead of MAX_NEW; matrix jobs run max-parallel at a time, each in its own throwaway VM with no secrets).
// The version checks run LOOKUPS at a time, alongside discovery; the result is the same as checking one by one.
// The matrix is ordered longest expected run first (last durationS in fleet/telemetry.jsonl) so one slow server
// does not start last and hold up the whole run; the set of jobs does not depend on that order.

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { canPlan, launchChanged } from "./overrides.mjs";

const FORCE_ALL = process.env.FORCE_ALL === "1";
const MAX_NEW = process.env.MAX_NEW ? Number(process.env.MAX_NEW) : 10;
const MATRIX_LIMIT = 256; // GitHub's cap on jobs in one matrix
const MAX_JOBS = Math.min(MATRIX_LIMIT, process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : FORCE_ALL ? MATRIX_LIMIT : 200);
const LOOKUPS = 8; // registry version checks in flight at once
const TARGET_TOTAL = process.env.TARGET_TOTAL ? Number(process.env.TARGET_TOTAL) : 360;
const GROW_NEW = process.env.GROW_NEW ? Number(process.env.GROW_NEW) : 60;
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
// A new server that already failed to start at a version is not tried again until it publishes a new version, so a
// handful of broken packages cannot fill every run's new slots. At most PER_PUBLISHER new servers per npm scope or
// GitHub owner per run, so one publisher's family cannot take them all either.
const PER_PUBLISHER = process.env.PER_PUBLISHER ? Number(process.env.PER_PUBLISHER) : 3;

function failedBefore() {
  const out = new Set();
  let text = "";
  try {
    text = readFileSync("fleet/history.jsonl", "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.status === "failed" && r.id) out.add(r.id + "@" + (r.version ?? ""));
    } catch {
      // skip a bad line
    }
  }
  return out;
}

function publisher(name) {
  const n = String(name ?? "").toLowerCase();
  if (n.startsWith("@")) return n.split("/")[0];
  if (n.includes("/")) return n.split("/")[0];
  return n;
}

// A probe: the launch line a GitHub repo's own files give, and its latest release when there is one. Probes are
// started for a whole page ahead of the loop, LOOKUPS at a time and in page order, then read in order by the loop,
// which still decides one by one; so a run finds the same servers as probing one at a time, only sooner.
function limiter(n) {
  let active = 0;
  const queue = [];
  const run = () => {
    while (active < n && queue.length) {
      const [fn, resolve] = queue.shift();
      active++;
      fn()
        .then(resolve, () => resolve(null))
        .finally(() => {
          active--;
          run();
        });
    }
  };
  return (fn) =>
    new Promise((resolve) => {
      queue.push([fn, resolve]);
      run();
    });
}
const probeSlot = limiter(LOOKUPS);
const probed = new Map();
function probe(repo, sub) {
  const key = repo.toLowerCase() + "|" + (sub ?? "");
  if (!probed.has(key)) {
    probed.set(
      key,
      probeSlot(async () => {
        const launch = await githubLaunch(repo, sub);
        return { launch, version: launch ? await latestVersion("github", repo) : null };
      }).then((r) => r ?? { launch: null, version: null }),
    );
  }
  return probed.get(key);
}

// The npm or PyPI stdio package a registry entry can be started from with no required settings, and whether it
// lists a package of another kind.
function usablePackage(server) {
  let hasOtherPkg = false;
  for (const p of server.packages ?? []) {
    if (p.registryType !== "npm" && p.registryType !== "pypi") {
      hasOtherPkg = true;
      continue;
    }
    if (p.transport?.type !== "stdio") continue;
    if ((p.environmentVariables ?? []).some((e) => e.isRequired === true)) continue;
    if ((p.packageArguments ?? []).some((a) => a.isRequired === true)) continue;
    return { pkg: p, hasOtherPkg };
  }
  return { pkg: null, hasOtherPkg };
}

const repoId = (repo) =>
  repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function discover(knownIds, maxNew) {
  const found = [];
  const failed = failedBefore();
  const perPublisher = new Map();
  const roomFor = (name) => (perPublisher.get(publisher(name)) ?? 0) < PER_PUBLISHER;
  const take = (name) => perPublisher.set(publisher(name), (perPublisher.get(publisher(name)) ?? 0) + 1);
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
    const latest = (data.servers ?? []).filter(
      (item) =>
        item.server &&
        item._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest === true &&
        !(EXCLUDE && EXCLUDE.test(item.server.name ?? "")),
    );
    // Start this page's GitHub probes (the loop below may still skip some of them).
    let ahead = probes;
    for (const { server } of latest) {
      if (ahead >= 60) break;
      if ((server.packages ?? []).length > 0 || (server.remotes ?? []).length > 0) continue;
      const repo = githubRepo(server);
      if (!repo || (EXCLUDE && EXCLUDE.test(repo))) continue;
      if (knownIds.has(repoId(repo)) || knownIds.has(repo.split("/")[1].toLowerCase())) continue;
      ahead++;
      probe(repo, server.repository?.subfolder);
    }
    for (const item of latest) {
      const server = item.server;
      const { pkg, hasOtherPkg } = usablePackage(server);
      if (pkg) {
        if (EXCLUDE && EXCLUDE.test(pkg.identifier ?? "")) continue;
        const id = pkg.identifier
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!id || knownIds.has(id)) continue;
        if (failed.has(id + "@" + pkg.version) || !roomFor(pkg.identifier)) continue;
        knownIds.add(id);
        take(pkg.identifier);
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
      const id = repoId(repo);
      if (!id || knownIds.has(id) || knownIds.has(repo.split("/")[1].toLowerCase())) continue;
      if (!roomFor(repo)) continue;
      probes++;
      const { launch, version: ghVersion } = await probe(repo, server.repository?.subfolder);
      if (!launch) continue;
      if (failed.has(id + "@" + (ghVersion ?? ""))) continue;
      knownIds.add(id);
      take(repo);
      found.push({
        id,
        name: repo,
        ecosystem: "github",
        launch,
        version: ghVersion,
        isNew: true,
      });
      if (found.length >= maxNew) break;
    }
    cursor = data.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }
  return found;
}

// Second source: public GitHub repos tagged mcp-server, most starred first, whose own files say how to start them.
// Search API only (30 requests a minute); the same no-credentials rules as the registry apply.
async function discoverTopics(knownIds, maxNew) {
  const found = [];
  const failed = failedBefore();
  const started = Date.now();
  let probes = 0;
  for (let page = 1; page <= 10 && found.length < maxNew && Date.now() - started < 240000; page++) {
    const data = await ghGet("search/repositories?q=topic:mcp-server+archived:false&sort=stars&order=desc&per_page=50&page=" + page);
    if (!data?.items?.length) break;
    // Start this page's probes (the loop below may still skip some of them).
    let ahead = probes;
    for (const it of data.items) {
      if (ahead >= 150) break;
      const repo = it.full_name;
      if (EXCLUDE && EXCLUDE.test(repo)) continue;
      if (knownIds.has(repoId(repo)) || knownIds.has(repo.split("/")[1].toLowerCase())) continue;
      ahead++;
      probe(repo, null);
    }
    for (const it of data.items) {
      if (found.length >= maxNew || probes >= 150) break;
      const repo = it.full_name;
      if (EXCLUDE && EXCLUDE.test(repo)) continue;
      const id = repoId(repo);
      if (!id || knownIds.has(id) || knownIds.has(repo.split("/")[1].toLowerCase())) continue;
      probes++;
      const { launch, version: ghVersion } = await probe(repo, null);
      if (!launch) continue;
      if (failed.has(id + "@" + (ghVersion ?? ""))) continue;
      knownIds.add(id);
      found.push({ id, name: repo, ecosystem: "github", launch, version: ghVersion, isNew: true });
    }
  }
  return found;
}

// fn over items with at most `limit` calls in flight; results in the order of items.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Longest expected run first (the server's last durationS in fleet/telemetry.jsonl; the median when it has none),
// so the slow ones start while the matrix still has free slots. Ties keep their order. Sorts in place.
function orderLongestFirst(jobs) {
  const last = new Map();
  let text = "";
  try {
    text = readFileSync("fleet/telemetry.jsonl", "utf8");
  } catch {
    return jobs;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.id && Number.isFinite(r.durationS)) last.set(r.id, r.durationS);
    } catch {
      // skip a bad line
    }
  }
  const known = [...last.values()].sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  const est = (j) => last.get(j.id) ?? median;
  return jobs.sort((a, b) => est(b) - est(a));
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
    if (typeof overrides[s.id] === "string") {
      // An override the stored grade was not made with makes the server due now, not in STALE_DAYS.
      s.launchChanged = launchChanged(s.launch, overrides[s.id], s.versionTested, (l, v) => (v ? pinLaunch(l, s.name, s.ecosystem, v) : l));
      s.launch = overrides[s.id];
    }
  }

  // Latest Sealmark release: every grade records the Sealmark version that made it,
  // and a new release makes every server due again.
  const t0 = Date.now();
  const secs = (t) => ((Date.now() - t) / 1000).toFixed(1) + "s";
  const sealmarkLatest = await latestVersion("npm", "sealmark");
  const plannable = tracked.filter((s) => canPlan(s.launch ?? ""));

  // Many registry servers fail to start without setup they don't declare, so try twice MAX_NEW to add about MAX_NEW.
  // Below TARGET_TOTAL the run grows the set (GROW_NEW unless a bigger MAX_NEW was asked for by hand).
  // FORCE_ALL re-tests every tracked server first; new tries only take the room left up to MAX_JOBS.
  const wantNew = tracked.length < TARGET_TOTAL ? Math.max(MAX_NEW, GROW_NEW) : MAX_NEW;
  const newTries = FORCE_ALL ? Math.min(wantNew * 2, Math.max(0, MAX_JOBS - plannable.length)) : wantNew * 2;

  // Discovery needs only the tracked ids, so it runs while the tracked versions are checked.
  const known = new Set(tracked.map((s) => s.id));
  const discovery = (async () => {
    const t = Date.now();
    if (newTries <= 0) return [];
    const fromRegistry = await discover(known, newTries);
    const found = [...fromRegistry];
    // Registry came up short of the tries: top up from GitHub topics while still below the target.
    if (tracked.length < TARGET_TOTAL && fromRegistry.length < newTries) {
      found.push(...(await discoverTopics(known, newTries - fromRegistry.length)));
    }
    console.log("discovery: " + found.length + " new to try in " + secs(t));
    return found;
  })();

  const tv = Date.now();
  const checked = await mapLimit(plannable, LOOKUPS, async (s) => {
    const launch = s.launch ?? "";
    const v = await latestVersion(s.ecosystem, s.name);
    let due = FORCE_ALL || s.launchChanged === true;
    // GitHub-only servers compare the release or tag they were tested at (refTested).
    const tested = s.ecosystem === "github" ? s.refTested : s.versionTested;
    if (!due && v && v !== tested) due = true;
    if (!due && sealmarkLatest && s.sealmark?.version !== sealmarkLatest) due = true;
    if (!due && !s.testedAt) due = true;
    if (!due && s.testedAt) {
      const days = (Date.now() - Date.parse(s.testedAt)) / 86400000;
      if (Number.isFinite(days) && days >= STALE_DAYS) due = true;
    }
    if (!due) return null;
    return {
      id: s.id,
      name: s.name,
      ecosystem: s.ecosystem,
      launch: v && s.ecosystem !== "github" ? pinLaunch(launch, s.name, s.ecosystem, v) : launch,
      version: v || s.versionTested || null,
      isNew: false,
    };
  });
  const jobs = checked.filter(Boolean);
  console.log("version checks: " + plannable.length + " tracked, " + jobs.length + " due in " + secs(tv));

  // Oldest results first; keep room for MAX_NEW new servers so a Sealmark release cannot crowd them out.
  const age = new Map(tracked.map((s) => [s.id, Date.parse(s.testedAt ?? "") || 0]));
  jobs.sort((a, b) => (age.get(a.id) ?? 0) - (age.get(b.id) ?? 0));
  const room = Math.max(0, MAX_JOBS - newTries);
  if (jobs.length > room) console.log(jobs.length - room + " due server(s) wait for a later run (MAX_JOBS " + MAX_JOBS + ")");
  jobs.length = Math.min(jobs.length, room);
  jobs.push(...(await discovery));
  jobs.length = Math.min(jobs.length, MAX_JOBS);
  orderLongestFirst(jobs);

  const plan = { generatedAt: new Date().toISOString(), jobs };
  writeFileSync("fleet-plan.json", JSON.stringify(plan, null, 2) + "\n");

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include: jobs }) + "\n");
    appendFileSync(process.env.GITHUB_OUTPUT, "count=" + jobs.length + "\n");
  }

  for (const j of jobs) {
    console.log(j.id + " " + (j.version ?? "-") + " " + (j.isNew ? "new" : "retest"));
  }
  console.log("planned " + jobs.length + " job(s)" + (FORCE_ALL ? " (force_all)" : "") + " in " + secs(t0));
}

main().catch((err) => {
  console.error("plan.mjs: " + err.message);
  process.exit(1);
});
