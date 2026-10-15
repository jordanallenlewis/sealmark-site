// Shared helpers for the docs shell (work package D1). The nav shape is frozen in the design notes:
// [{ group, items: [{ title, url, status }] }] in reading order.

export type NavStatus = "shipped" | "planned" | "opt-in";
export interface NavItem {
  title: string;
  url: string;
  status: NavStatus;
}
export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** "/docs/reference/cli/" and "/docs/reference/cli" are the same page (the export uses trailing slashes). */
export function normalizePath(p: string): string {
  const bare = p.split("#")[0].split("?")[0];
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

export interface FlatItem extends NavItem {
  group: string;
}

export function flatten(nav: NavGroup[]): FlatItem[] {
  return nav.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
}

/** The listed page that contains `path` (for pages that are not in the nav, such as one check below "Checks"). */
export function parentOf(path: string, flat: FlatItem[]): FlatItem | undefined {
  const here = normalizePath(path);
  return flat
    .filter((i) => here.startsWith(normalizePath(i.url) + "/"))
    .sort((a, b) => b.url.length - a.url.length)[0];
}
