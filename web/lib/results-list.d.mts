import type { ListRow, ServerResult } from "./results-shared";
export const LIST_FIELDS: string[];
export const DERIVED_FIELDS: string[];
export function listRow(x: ServerResult, runs?: readonly { date: string; status: string; worst?: string }[]): ListRow;
