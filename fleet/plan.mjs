// Plans a fleet run: which tracked MCP servers to re-test, plus a few new ones
// from the MCP Registry. Writes fleet-plan.json and, on GitHub Actions, a
// matrix output.
//
// Run from the repository root: node fleet/plan.mjs
// Env: FORCE_ALL (1 = re-test everything), MAX_NEW (default 5),
//      MAX_JOBS (default 40), STALE_DAYS (default 7).

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const FORCE_ALL = process.env.FORCE_ALL === "1";
const MAX_NEW = process.env.MAX_NEW ? Number(process.env.MAX_NEW) : 5;
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

// Official registry servers we do not track yet; at most 5 pages, up to maxNew.
async function discover(knownIds, maxNew) {
  const found = [];
  let cursor = null;
  for (let page = 0; page < 5 && found.length < maxNew; page++) {
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
      for (const p of server.packages ?? []) {
        if (p.registryType !== "npm" && p.registryType !== "pypi") continue;
        if (p.transport?.type !== "stdio") continue;
        if ((p.environmentVariables ?? []).some((e) => e.isRequired === true)) continue;
        if ((p.packageArguments ?? []).some((a) => a.isRequired === true)) continue;
        pkg = p;
        break;
      }
      if (!pkg) continue;
      if (EXCLUDE && EXCLUDE.test(pkg.identifier ?? "")) continue;
      const id = pkg.identifier
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!id || knownIds.has(id)) continue;
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

  const jobs = [];
  for (const s of tracked) {
    const launch = s.launch ?? "";
    if (launch.includes("<workspace>")) continue;
    const v = await latestVersion(s.ecosystem, s.name);
    let due = FORCE_ALL;
    if (!due && v && v !== s.versionTested) due = true;
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
      launch: v ? pinLaunch(launch, s.name, s.ecosystem, v) : launch,
      version: v || s.versionTested || null,
      isNew: false,
    });
  }

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
