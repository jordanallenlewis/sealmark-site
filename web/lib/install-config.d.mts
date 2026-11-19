export const FILL: Record<string, string>;
export function splitLaunch(s: string): string[] | null;
export function installConfig(x: { id: string; transport?: string; launch: string; versionTested: string }, opt?: { withheld?: boolean }): { json: string; claude: string; fill: string[] } | null;
