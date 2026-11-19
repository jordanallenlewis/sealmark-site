export const STATUS_DAYS: number;
export function fleetStatus<T>(hasGrade: (x: T) => boolean, servers: T[] | undefined, histories: { id: string; runs: { date: string; status: string }[] }[] | undefined, notGraded: { count?: unknown; byReason?: Record<string, number> } | undefined): {
  listed: number; graded: number; fresh: number; freshPct: number | null; staleAfter: number; latest: string | null; oldest: string | null;
  days: { date: string; graded: number; failed: number }[]; retests: number; notGraded: number;
  reasons: { reason: string; count: number; label: string; meaning: string }[];
};
