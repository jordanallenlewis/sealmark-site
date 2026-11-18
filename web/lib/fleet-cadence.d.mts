export declare const CADENCE_DAYS: number;
export type FleetCadence = { runs: number; scheduled: number; onRequest: number; lastAt: string; from: string; to: string; gapsH: number[]; medianGapH: number | null; longestGapH: number | null };
export declare function fleetCadence(text: string | undefined): FleetCadence | null;
export declare function scheduledHours(workflowText: string | undefined): number | null;
