// Types for web/content/generated/*.json. Source of truth for the shapes: the output of `sealmark describe`
// (format sealmark.describe/1, cli/src/describe.ts) mapped by scripts/docs-gen.mjs. Regenerate with `npm run docs:gen`;
// `npm run docs:check` fails when the committed files differ from what the built CLI prints.

export type PackId = string;
export type VerifiedBy = "db-state" | "response" | "protocol" | "static" | "listener" | "process" | "filesystem" | "sandbox" | string;
export type DocStatus = "shipped" | "planned" | "opt-in";
/** Verdict words as the CLI reports them. */
export type VerdictKey = "pass" | "part" | "fail" | "inconclusive" | "na";

export interface CheckProbe {
  id: string;
  text: string;
  kind: string;
  /** true when the probe is part of the core of the check (a verdict needs it); absent for packs that do not mark it. */
  core?: boolean;
}

export interface CheckThreshold {
  default: number | string | boolean | null;
  configKey: string;
  standardLocked: boolean;
}

export interface CheckSetting {
  path: string;
  default: unknown;
  description: string;
  standardLocked: boolean;
}

export interface CheckDescriptor {
  id: string;
  pack: PackId;
  label: string;
  critical: boolean;
  advisory: boolean;
  /** What the check measures, in one line. */
  scope: string;
  /** What decides the verdict. Empty when the check is not measured. */
  verifiedBy: VerifiedBy[];
  probes: CheckProbe[];
  thresholds: Record<string, CheckThreshold>;
  falsePositive: string;
  falseNegative: string;
  /** Config key paths that affect this check. */
  configKeys: string[];
  since: string;
  status: DocStatus;
  /** How the check counts: critical, scored or advisory. */
  severity: "critical" | "scored" | "advisory";
  standardLocked: boolean;
  inStandardPacks: boolean;
  /** A candidate check is reported but not scored in the standard methodology yet. */
  candidate: boolean;
  /** Retired check ids this one replaces. */
  replaces?: string[];
  /** From `sealmark explain <id> --json`. */
  remediation: string;
  scoring: string;
  settings: CheckSetting[];
}

export interface ConfigKey {
  path: string;
  type: string;
  default: unknown;
  description: string;
  since: string;
  standardLocked: boolean;
  mergeable: boolean;
  secret: boolean;
  flagOnly: boolean;
  deprecated: boolean;
}

export interface CliCommand {
  name: string;
  usage: string;
  summary: string;
}

export interface CliFlag {
  /** With the leading dashes, as typed. */
  name: string;
  type: string;
  metavar?: string;
  description: string;
  /** Same as description (the page reads this one). */
  doc: string;
  commands: string[];
  schemaPath?: string;
  negatable?: boolean;
  safety?: boolean;
  short?: string;
  /** Present (as "planned") for a flag that is designed but rejected by the parser. */
  status?: "planned";
  [extra: string]: unknown;
}

export interface CliExitCode {
  code: number;
  meaning: string;
}

export interface CliDescription {
  commands: CliCommand[];
  flags: CliFlag[];
  exitCodes: CliExitCode[];
}

export interface PackDescriptor {
  id: string;
  standard: boolean;
  checks: string[];
}

export interface ProfileDescriptor {
  name: string;
  shipped: boolean;
  standard: boolean;
  description: string;
  extends?: string;
}

export interface GeneratedMeta {
  methodology: string;
  cliVersion: string;
  format: string;
  /** Always "describe": the files are written by docs:gen from the built CLI. */
  source: string;
}
