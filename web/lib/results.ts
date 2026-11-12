// Real-world results: ONE data file (content/data/server-results.json), generated from Sealmark's own JSON reports of the
// default-configuration run. Review or gate this file as a unit before deploying (owner rule: real server names are shown).
import raw from "@/content/data/server-results.json";
import disclosureFile from "@/content/data/disclosure.json";
import { deepPacks, gradedPacks, type ServerResult } from "./results-shared";
import { redactedChecks, type Disclosure, type DisclosureEntry } from "./disclosure.mjs";
export * from "./results-shared";
export { isSecurityCheck, isSecurityFinding, isWeakSignal } from "./disclosure.mjs";
export type { Disclosure };

// Security findings under private disclosure (lib/disclosure.mjs). Their status lives in content/data/disclosure.json;
// the build date decides whether a reported finding has reached its publish date.
const DISCLOSURE = (disclosureFile as { findings: Record<string, DisclosureEntry> }).findings;
export const BUILD_DATE = new Date().toISOString().slice(0, 10);
/** The checks on this server whose details stay off the public page, with their disclosure state. */
export const redactionsFor = (x: ServerResult): Map<string, Disclosure> => redactedChecks(x, DISCLOSURE, BUILD_DATE);

type Round = { name: string; truePass: number; trueFail: number; falsePass: number; falseFail: number; unjustifiedInconclusive: number; justifiedInconclusive: number; naCorrect: number; naWrong: number; unverified: number };
export const DATA = raw as unknown as { generatedFrom: string; methodology: string; servers: ServerResult[]; verification: { note: string; rounds: Round[] } };
// Real-server results are published (owner, 2026-10-15). A build with SEALMARK_PUBLISH_RESULTS=0 hides them again.
export const RESULTS_PUBLIC = process.env.SEALMARK_PUBLISH_RESULTS !== "0";
export const SERVERS_RESULTS: ServerResult[] = RESULTS_PUBLIC ? DATA.servers : [];

// Counts shown on the home and results pages. Computed once here from the data; never hardcode them in a page.
export const SERVER_COUNT = SERVERS_RESULTS.length;
export const BELOW_A_COUNT = SERVERS_RESULTS.filter((x) => gradedPacks(x).some((p) => p.letter !== "A")).length;
export const CRIT_FAIL_COUNT = SERVERS_RESULTS.filter((x) => deepPacks(x).some((p) => p.criticalFails.length > 0)).length;
// Every verdict that was compared with an independent check (all rounds, all outcomes).
export const VERDICTS_CHECKED = DATA.verification.rounds.reduce(
  (t, r) => t + r.truePass + r.trueFail + r.falsePass + r.falseFail + r.justifiedInconclusive + r.unjustifiedInconclusive + r.naCorrect + r.naWrong + r.unverified,
  0,
);
