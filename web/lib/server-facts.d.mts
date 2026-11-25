export const STALE_DAYS: number;
export type ServerFactsEntry = {
  checkedAt?: string;
  source?: string;
  license?: string | null;
  licenseFrom?: string;
  latest?: { version?: string; date?: string | null } | null;
  repo?: { name?: string; pushedAt?: string | null; archived?: boolean; openIssues?: number | null } | null;
};
export type ServerFacts = {
  license: string | null;
  kind: "package" | "project";
  licenseFrom: "package" | "repo";
  latest: { version: string; date: string | null; graded: boolean | null } | null;
  repo: { name: string; url: string; pushed: string | null; archived: boolean; openIssues: number | null } | null;
  checked: string;
  from: string;
};
export function serverFacts(e: ServerFactsEntry | undefined, server: { ecosystem: string; versionTested: string }, o: { held: boolean; today: string }): ServerFacts | null;
export const CLAIM_PATH: string;
export type MaintainerClaim =
  | { state: "claimed"; repo: string; url: string; checked: string }
  | { state: "unclaimed"; repo: string; url: string; path: string; file: string };
export function maintainerClaim(
  e: (ServerFactsEntry & { claim?: { repo?: string; checkedAt?: string; ended?: string }; claimable?: boolean }) | undefined,
  server: { id: string },
  o: { held: boolean; today: string },
): MaintainerClaim | null;
