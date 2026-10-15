// Shared bits for the generated reference pages. Server components only.
import type { CheckDescriptor, GeneratedMeta, PackDescriptor, VerifiedBy } from "@/lib/generated";
import checksJson from "@/content/generated/checks.json";
import metaJson from "@/content/generated/meta.json";
import packsJson from "@/content/generated/packs.json";
import { loadProse } from "../content";
import s from "./ref.module.css";

export const CHECKS = checksJson as unknown as CheckDescriptor[];
export const PACKS = packsJson as PackDescriptor[];
export const META = metaJson as GeneratedMeta;

/** Where a reference table came from. Every generated file is written by docs:gen from the built CLI. */
export const provenance = (what: string) => `Generated from the CLI's own description of ${what} (methodology ${META.methodology}, CLI ${META.cliVersion}).`;

const VB_TITLE: Record<string, string> = {
  "db-state": "the harness read the database itself",
  response: "decided from what the server returned",
  protocol: "decided from the MCP exchange",
  static: "decided by reading the declared metadata",
  listener: "the harness listener saw (or did not see) the request",
  process: "the harness read the process table",
  "fs-observer": "the harness read the sandbox files itself",
  http: "decided from the HTTP exchange with the server",
};
export const VerifiedChips = ({ list }: { list: VerifiedBy[] }) =>
  list.length ? (
    <>
      {list.map((v) => (
        <span key={v} className="chip c-na" title={VB_TITLE[v]} style={{ fontWeight: 500 }}>
          {v}
        </span>
      ))}
    </>
  ) : (
    <span style={{ color: "var(--ink-faint)" }}>not measured</span>
  );

/** The id used for a config key's anchor on the configuration page. */
export const keyId = (path: string) => `key-${path.replace(/[^a-zA-Z0-9_]+/g, "-")}`;

/** Renders the hand-written companion MDX of a generated page, if one exists yet. */
export async function Prose({ file, heading }: { file: string; heading?: string }) {
  const mod = await loadProse(file);
  if (!mod) return null;
  const Content = mod.default;
  return (
    <div>
      {heading ? <h2 className={s.h2} id="notes">{heading}</h2> : null}
      <Content />
    </div>
  );
}
