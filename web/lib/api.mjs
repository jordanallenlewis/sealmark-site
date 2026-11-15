// The public read-only JSON API under /data/v1/ (docs: /docs/guides/results-data). Static files written at build time
// from the same data as the results pages (content/data/server-results.json, fleet/history.jsonl): no key, no Worker,
// no database. /api/* belongs to the notify Worker (wrangler.jsonc run_worker_first), so the API lives under /data/.
// Pure functions, no I/O: covered by lib/api.test.mjs; scripts/api-check.mjs compares the built files with the pages.
//
// Private disclosure (lib/disclosure.mjs) holds here exactly as on the page: a redacted finding's summary is null with
// its disclosure state, a sibling security check in the same test area has its summary held back, and the start command
// and the command to repeat the run are null while any finding on the server is private.
import { isSecurityCheck, isWeakSignal } from "./disclosure.mjs";
import { reproduceCommand } from "./results-copy.mjs";

export const API_VERSION = "v1";
export const API_BASE = `/data/${API_VERSION}`;
/** Newest grade changes kept in changes.json. */
export const CHANGES_LIMIT = 500;

/** @param {string} id */
export const serverPath = (id) => `${API_BASE}/servers/${id}.json`;
/** @param {string} id */
export const pagePath = (id) => `/results/${id}/`;

/**
 * One server in the list.
 * @param {any} x a ServerResult
 * @param {{ letter: string, provisional: boolean } | null} grade the page's overall grade (null: no grade shown)
 * @param {string} site absolute origin, e.g. https://sealmark.dev
 */
export function serverSummary(x, grade, site) {
  return {
    id: x.id,
    name: x.name,
    ecosystem: x.ecosystem,
    versionTested: x.versionTested,
    testedAt: x.testedAt,
    grade: grade ? grade.letter : null,
    provisional: grade ? grade.provisional : false,
    packs: Object.fromEntries(x.packs.filter((p) => p.status === "graded" && p.letter).map((p) => [p.id, p.letter])),
    toolCount: x.toolCount,
    transport: x.transport,
    lastAttemptFailed: x.lastAttempt ? x.lastAttempt.date : null,
    page: site + pagePath(x.id),
    json: site + serverPath(x.id),
  };
}

/**
 * One server in full: every test area and check, what was not covered, its grade history and how to repeat the run.
 * @param {any} x a ServerResult
 * @param {{ letter: string, provisional: boolean } | null} grade
 * @param {Map<string, { status: string, reportedAt: string | null, publishAfter: string | null }>} redactions redactionsFor(x)
 * @param {{ date: string, version: string, sealmark?: string, status: string, worst?: string, packs: Record<string, string> }[]} runs
 * @param {string} site
 */
export function serverDoc(x, grade, redactions, runs, site) {
  const privatePacks = new Set(x.checks.filter((c) => redactions.has(c.id)).map((c) => c.pack));
  const held = redactions.size > 0;
  return {
    ...serverSummary(x, grade, site),
    sealmark: { version: x.sealmark.version, methodology: x.sealmark.methodology },
    standard: x.standard,
    configHash: x.configHash,
    automated: x.automated === true,
    coverage: x.coverage ?? null,
    packDetails: x.packs.map((p) => ({
      id: p.id, status: p.status, letter: p.letter, points: p.points, scored: p.scored, pct: p.pct,
      provisional: p.provisional, capped: p.capped, criticalFails: p.criticalFails, reason: p.reason ?? null,
    })),
    checks: x.checks.map((c) => {
      const d = redactions.get(c.id);
      const sibling = !d && privatePacks.has(c.pack) && isSecurityCheck(c);
      return {
        id: c.id, pack: c.pack, label: c.label, critical: c.critical, advisory: c.advisory, verdict: c.verdict,
        weakSignal: isWeakSignal(c),
        summary: d || sibling ? null : c.summary,
        disclosure: d ? { status: d.status, reportedAt: d.reportedAt, publishAfter: d.publishAfter } : sibling ? { status: "held-with-sibling" } : null,
        docs: `${site}/docs/reference/checks/${c.id}/`,
      };
    }),
    notCovered: x.notCovered,
    lastAttempt: x.lastAttempt ?? null,
    launch: held ? null : x.launch,
    reproduce: held ? null : reproduceCommand(x.sealmark.version, x.launch),
    history: runs.map((r) => ({ date: r.date, version: r.version, sealmark: r.sealmark ?? null, status: r.status, grade: r.worst ?? null, packs: r.packs })),
  };
}

/**
 * The list document.
 * @param {ReturnType<typeof serverSummary>[]} items
 * @param {{ methodology: string, generatedAt: string }} meta
 */
export function serversDoc(items, meta) {
  return { version: API_VERSION, generatedAt: meta.generatedAt, methodology: meta.methodology, count: items.length, servers: items };
}

/**
 * Grade changes between consecutive successful runs of the same server, newest first. A failed run sits between two
 * runs without breaking the comparison: it says nothing about the grade. The first run of a server is not a change.
 * @param {{ id: string, name: string, linked: boolean, runs: { date: string, version: string, sealmark?: string, status: string, worst?: string, packs: Record<string, string> }[] }[]} histories
 * @param {string} site
 * @param {string} generatedAt
 * @param {number} [limit]
 */
export function changesDoc(histories, site, generatedAt, limit = CHANGES_LIMIT) {
  const out = [];
  for (const h of histories) {
    let prev = null;
    for (const r of h.runs) {
      if (r.status !== "ok" || !r.worst) continue;
      if (prev) {
        const packs = {};
        for (const k of new Set([...Object.keys(prev.packs), ...Object.keys(r.packs)])) {
          if (prev.packs[k] !== r.packs[k]) packs[k] = { from: prev.packs[k] ?? null, to: r.packs[k] ?? null };
        }
        if (prev.worst !== r.worst || Object.keys(packs).length) {
          out.push({
            date: r.date, id: h.id, name: h.name, from: prev.worst, to: r.worst, packs,
            previousVersion: prev.version, version: r.version, sealmark: r.sealmark ?? null,
            page: h.linked ? site + pagePath(h.id) : null,
          });
        }
      }
      prev = r;
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { version: API_VERSION, generatedAt, count: Math.min(out.length, limit), total: out.length, changes: out.slice(0, limit) };
}

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const letter = { type: ["string", "null"], enum: ["A", "B", "C", "D", "F", null] };

/**
 * OpenAPI 3.1 description of the four files.
 * @param {string} site
 * @param {string} cliVersion
 */
export function openapiDoc(site, cliVersion) {
  const json = (ref, description) => ({ description, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
  const summary = {
    type: "object",
    required: ["id", "name", "ecosystem", "versionTested", "testedAt", "grade", "provisional", "packs", "page", "json"],
    properties: {
      id: str, name: str, ecosystem: { type: "string", enum: ["npm", "pypi", "github"] }, versionTested: str,
      testedAt: { type: "string", format: "date" }, grade: letter, provisional: { type: "boolean" },
      packs: { type: "object", additionalProperties: str, description: "graded test areas only: id to letter" },
      toolCount: { type: "integer" }, transport: str,
      lastAttemptFailed: { ...strOrNull, description: "date of a later re-test that failed; the grade is from the earlier run" },
      page: { type: "string", format: "uri" }, json: { type: "string", format: "uri" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Sealmark results data",
      version: API_VERSION,
      description: `Read-only grades of public MCP servers from Sealmark's automated re-tests (CLI ${cliVersion}). Static files, no key, CORS open. Grades are automated results for one version with the default settings, not endorsements.`,
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: site + API_BASE }],
    paths: {
      "/servers.json": { get: { operationId: "listServers", summary: "Every graded server", responses: { 200: json("ServerList", "The list") } } },
      "/servers/{id}.json": {
        get: {
          operationId: "getServer", summary: "One server: test areas, checks, history, repeat command",
          parameters: [{ name: "id", in: "path", required: true, schema: str, description: "the id in /results/<id>/" }],
          responses: { 200: json("Server", "The server"), 404: { description: "No graded server with that id" } },
        },
      },
      "/changes.json": { get: { operationId: "listChanges", summary: `Grade changes between re-tests, newest first (last ${CHANGES_LIMIT})`, responses: { 200: json("ChangeList", "The changes") } } },
      "/openapi.json": { get: { operationId: "openapi", summary: "This document", responses: { 200: { description: "OpenAPI 3.1" } } } },
    },
    components: {
      schemas: {
        ServerSummary: summary,
        ServerList: { type: "object", properties: { version: str, generatedAt: { type: "string", format: "date-time" }, methodology: str, count: { type: "integer" }, servers: { type: "array", items: { $ref: "#/components/schemas/ServerSummary" } } } },
        Server: {
          allOf: [{ $ref: "#/components/schemas/ServerSummary" }],
          type: "object",
          properties: {
            sealmark: { type: "object", properties: { version: str, methodology: str } },
            standard: { type: ["boolean", "null"] }, configHash: str, automated: { type: "boolean" },
            packDetails: { type: "array", description: "every test area, graded or not, with the reason it was not", items: { type: "object", properties: { id: str, status: str, letter, points: { type: ["number", "null"] }, scored: { type: ["number", "null"] }, pct: { type: ["number", "null"] }, provisional: { type: "boolean" }, capped: { type: "boolean" }, criticalFails: { type: "array", items: str }, reason: strOrNull } } },
            checks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: str, pack: str, label: str, critical: { type: "boolean" }, advisory: { type: "boolean" },
                  verdict: { type: "string", enum: ["pass", "part", "fail", "inconclusive", "na"] }, weakSignal: { type: "boolean" },
                  summary: { ...strOrNull, description: "null while a security finding in this test area is reported privately" },
                  disclosure: { type: ["object", "null"], properties: { status: str, reportedAt: strOrNull, publishAfter: strOrNull } },
                  docs: { type: "string", format: "uri" },
                },
              },
            },
            notCovered: { type: "array", items: str },
            launch: { ...strOrNull, description: "null while a security finding is reported privately" },
            reproduce: { ...strOrNull, description: "command that repeats the run; null while a security finding is reported privately" },
            history: { type: "array", items: { type: "object", properties: { date: str, version: str, sealmark: strOrNull, status: { type: "string", enum: ["ok", "failed"] }, grade: letter, packs: { type: "object", additionalProperties: str } } } },
          },
        },
        ChangeList: {
          type: "object",
          properties: {
            version: str, generatedAt: { type: "string", format: "date-time" }, count: { type: "integer" }, total: { type: "integer" },
            changes: { type: "array", items: { type: "object", properties: { date: str, id: str, name: str, from: letter, to: letter, packs: { type: "object" }, previousVersion: str, version: str, sealmark: strOrNull, page: { type: ["string", "null"] } } } },
          },
        },
      },
    },
  };
}
