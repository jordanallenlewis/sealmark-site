// Server-only: the /data/v1/ documents (lib/api.mjs) built from the results data. Shared by the routes in app/data/v1.
import { changesDoc, openapiDoc, serverDoc, serverSummary, serversDoc } from "@/lib/api.mjs";
import { historyFor, loadHistory } from "@/lib/history";
import { DATA, SERVERS_RESULTS, deepPacks, redactionsFor, worst, type ServerResult } from "@/lib/results";
import { coverageNote } from "@/lib/results-copy.mjs";
import { CLI_VERSION, ORIGIN } from "@/lib/seo";

const GENERATED_AT = new Date().toISOString();
// The overall grade exactly as the results page heads it: none for a server with no tools, else the lowest graded area.
const gradeOf = (x: ServerResult) => (coverageNote(x, deepPacks(x).length > 0).kind === "no-tools" ? null : worst(x));

export const apiServers = () => serversDoc(SERVERS_RESULTS.map((x) => serverSummary(x, gradeOf(x), ORIGIN)), { methodology: DATA.methodology, generatedAt: GENERATED_AT });
export const apiServer = (x: ServerResult) => serverDoc(x, gradeOf(x), redactionsFor(x), historyFor(x.id)?.runs ?? [], ORIGIN);
export const apiChanges = () => changesDoc(loadHistory(), ORIGIN, GENERATED_AT);
export const apiOpenapi = () => openapiDoc(ORIGIN, CLI_VERSION);
export const jsonResponse = (doc: unknown) => new Response(`${JSON.stringify(doc, null, 2)}\n`, { headers: { "content-type": "application/json; charset=utf-8" } });
