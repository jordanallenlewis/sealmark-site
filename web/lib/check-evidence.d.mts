export const MAX_LINES: number;
export const MAX_TEXT: number;
export const SOURCE_WORDS: Record<string, string>;
export type EvidenceLine = { probe: string; outcome: string; by: string | null; how: string | null; tool: string | null };
export type CheckEvidence = { total: number; lines: EvidenceLine[] };
export function checkEvidence(
  record: unknown,
  server: { testedAt: string; sealmark: { version: string }; configHash: string; checks: Array<{ id: string; critical?: boolean; advisory?: boolean; verdict?: string; summary?: string | null }> },
  o: { held: boolean },
): Map<string, CheckEvidence> | null;
