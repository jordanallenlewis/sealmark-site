// Server-only helpers for the docs routes (work package D2). Not a route: Next only routes page/layout/route files.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";

export type DocStatus = "shipped" | "planned" | "opt-in";
export interface DocMeta {
  title: string;
  since: string;
  status: DocStatus;
  description?: string;
}
export interface DocModule {
  default: ComponentType<{ components?: Record<string, unknown> }>;
  meta?: DocMeta;
}
export interface DocEntry {
  /** URL segments below /docs. Empty for /docs itself. */
  slug: string[];
  /** Path below content/docs without the extension, e.g. "reference/checks/rls". */
  file: string;
}

const ROOT = path.join(process.cwd(), "content", "docs");

function walk(dir: string, rel: string[] = []): string[][] {
  const out: string[][] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), [...rel, e.name]));
    else if (e.name.endsWith(".mdx")) out.push([...rel, e.name.slice(0, -4)]);
  }
  return out;
}

/** Slugs that have a dedicated route under app/docs/reference. Their MDX files are prose companions, not pages. */
export const isGeneratedRoute = (slug: string[]) => slug[0] === "reference" && (slug[1] === "configuration" || slug[1] === "cli" || slug[1] === "checks");

/** Every content/docs/**\/*.mdx file that becomes a page through app/docs/[[...slug]]. */
export function listDocs(): DocEntry[] {
  if (!existsSync(ROOT)) return [];
  return walk(ROOT)
    .map((parts) => ({ file: parts.join("/"), slug: parts[parts.length - 1] === "index" ? parts.slice(0, -1) : parts }))
    .filter((d) => !isGeneratedRoute(d.slug));
}

/** The compiled MDX module for a file below content/docs. */
export async function loadDoc(file: string): Promise<DocModule> {
  return (await import(`@/content/docs/${file}.mdx`)) as DocModule;
}

/** The hand-written companion of a generated reference page, or null when there is none yet. */
export async function loadProse(file: string): Promise<DocModule | null> {
  return existsSync(path.join(ROOT, `${file}.mdx`)) ? loadDoc(file) : null;
}
