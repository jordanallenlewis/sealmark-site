export type AnswerGrade = { letter: string; provisional: boolean } | null;
export type AnswerArea = { label: string; letter: string; provisional: boolean };
export function verdictCounts(checks: { verdict?: unknown }[] | undefined): { verdict: string; count: number }[];
export function answerSummary(a: {
  name: string; version: string; testedAt: string; sealmark: string; standard: boolean;
  grade: AnswerGrade; areas: AnswerArea[]; coverage: { kind: string; text: string }; checks: { verdict: string; advisory?: boolean }[]; held: boolean; withdrawn?: string | null;
}): string;
export function serverJsonLd(a: {
  site: string; page: string; json: string; list: string; name: string; version: string; testedAt: string;
  grade: AnswerGrade; areas: AnswerArea[]; checks: { verdict: string; advisory?: boolean }[]; summary: string; author: object;
}): object;
export function answerPageProblems(html: string, want: { page: string; grade: AnswerGrade; withheld: string[] }): string[];
