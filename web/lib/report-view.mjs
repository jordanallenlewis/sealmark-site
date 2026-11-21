// Shareable report links (sealmark#33). Pure code for the /report/ viewer: reads a Sealmark JSON report (one run, or
// { runs: [...] }), keeps only what the page shows, and cuts every string to a limit. Nothing here touches the network; the
// viewer never uploads a report. `sealmark share` (CLI) writes the fragment this reads: `#r=` + base64url(raw deflate(JSON)).
export const MAX_INPUT = 5_000_000;
export const MAX_FRAGMENT = 1_400_000;
export const MAX_TEXT = 400;
export const MAX_CHECKS = 400;
export const MAX_EVIDENCE = 12;
export const MAX_RUNS = 20;
const LETTERS = new Set(["A", "B", "C", "D", "F"]);
const VERDICTS = new Set(["pass", "part", "fail", "inconclusive", "na"]);
const STATUSES = new Set(["graded", "na", "inconclusive"]);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** A string cut to MAX_TEXT, with control and bidi-override characters removed. Anything else becomes "". */
export function text(v, max = MAX_TEXT) {
  if (typeof v !== "string") return "";
  const s = v.replace(CONTROL, "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

function evidence(e) {
  const o = obj(e);
  if (!o) return null;
  return { probe: text(o.probe), outcome: text(o.outcome), verifiedBy: text(o.verifiedBy, 60), tool: text(o.tool, 120) || null, role: text(o.role, 60) || null };
}

function check(c) {
  const o = obj(c);
  if (!o || typeof o.id !== "string") return null;
  const ev = Array.isArray(o.evidence) ? o.evidence.map(evidence).filter(Boolean) : [];
  return {
    id: text(o.id, 120),
    pack: text(o.pack, 60),
    label: text(o.label) || text(o.id, 120),
    scope: text(o.scope),
    verdict: VERDICTS.has(o.verdict) ? o.verdict : "inconclusive",
    summary: text(o.summary),
    critical: o.critical === true,
    advisory: o.advisory === true,
    evidence: ev.slice(0, MAX_EVIDENCE),
    evidenceCut: Math.max(0, ev.length - MAX_EVIDENCE),
  };
}

function view(r) {
  const server = obj(r.server);
  const checks = Array.isArray(r.checks) ? r.checks.map(check).filter(Boolean) : [];
  const packs = Object.entries(obj(r.packs) ?? {}).slice(0, 40).map(([id, p]) => {
    const po = obj(p) ?? {};
    const letter = obj(po.grade)?.letter;
    const g = obj(po.grade) ?? {};
    return {
      id: text(id, 60),
      status: STATUSES.has(po.status) ? po.status : "inconclusive",
      letter: LETTERS.has(letter) ? letter : null,
      pct: typeof g.pct === "number" && Number.isFinite(g.pct) ? Math.round(g.pct) : null,
      provisional: g.provisional === true,
      capped: g.capped === true,
      reason: text(po.reason) || null,
    };
  });
  return {
    server: { name: text(server.name, 200), version: text(server.version, 120), command: text(server.command, 600), transport: text(server.transport, 20) },
    sealmark: { version: text(obj(r.sealmark)?.version, 40), methodology: text(obj(r.sealmark)?.methodology, 40) },
    startedAt: text(r.startedAt, 40),
    standard: obj(r.config)?.standard === true ? true : obj(r.config)?.standard === false ? false : null,
    configHash: text(obj(r.config)?.hash, 80) || null,
    coverage: text(obj(r.coverage)?.level, 30) || null,
    packs,
    checks: checks.slice(0, MAX_CHECKS),
    checksCut: Math.max(0, checks.length - MAX_CHECKS),
    notCovered: Array.isArray(r.notCovered) ? r.notCovered.slice(0, 40).map((n) => text(n)).filter(Boolean) : [],
    warnings: Array.isArray(r.warnings) ? r.warnings.slice(0, 20).map((n) => text(n)).filter(Boolean) : [],
  };
}

const isRun = (r) => obj(r) && obj(r.packs) && Array.isArray(r.checks) && obj(r.server) && typeof obj(r.server).name === "string";

/** { ok: true, runs, failed } or { ok: false, error }. Never throws. */
export function parseReport(input) {
  if (typeof input !== "string") return { ok: false, error: "The report must be text." };
  if (input.length > MAX_INPUT) return { ok: false, error: "That file is too large to be a Sealmark report." };
  const t = input.replace(/^﻿/, "").trim();
  if (!t) return { ok: false, error: "The report is empty." };
  let data;
  try { data = JSON.parse(t); } catch (e) { return { ok: false, error: `That is not valid JSON (${text(e instanceof Error ? e.message : "parse error", 120)}).` }; }
  const list = obj(data) && Array.isArray(data.runs) ? data.runs : [data];
  const runs = list.filter(isRun).slice(0, MAX_RUNS).map(view);
  const failed = list.filter((r) => obj(r) && !isRun(r) && typeof r.server === "string" && typeof r.error === "string").slice(0, MAX_RUNS).map((r) => ({ server: text(r.server, 200) }));
  if (!runs.length) return { ok: false, error: "There is no Sealmark run in that file. Open the JSON written by sealmark run --format json, or a --write-baseline file." };
  return { ok: true, runs, failed };
}

const B64 = /^[A-Za-z0-9_-]+$/;
export function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** The compressed bytes in a `#r=...` fragment, or null when the fragment is not ours or not base64url. */
export function fragmentBytes(hash) {
  const m = /^#?r=(.*)$/.exec(typeof hash === "string" ? hash : "");
  if (!m || !m[1] || m[1].length > MAX_FRAGMENT || !B64.test(m[1])) return null;
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
