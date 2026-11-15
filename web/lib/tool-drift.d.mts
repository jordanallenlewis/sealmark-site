export type ToolDrift = { added: string[]; removed: string[]; changed: string[] };
export function toolDrift(
  x: { testedAt?: string; checks?: unknown[]; toolSchemas?: unknown; toolSchemasBefore?: unknown },
  change: { from: { date: string; sealmark?: string }; to: { date: string; sealmark?: string } } | null,
  redactions?: Map<string, unknown>,
): ToolDrift | null;
