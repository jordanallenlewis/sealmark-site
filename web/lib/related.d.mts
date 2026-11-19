export type Related = { id: string; name: string; shared: string[]; letter: "A" | "B" | "C" | "D" | "F" | null; provisional: boolean };
export function relatedServers(
  x: { id: string; name: string; packs: { id: string; status: string; letter: string | null; provisional?: boolean }[] },
  all: { id: string; name: string; packs: { id: string; status: string; letter: string | null; provisional?: boolean }[] }[],
): Related[];
