import { clsx } from "clsx";
// <Status kind="shipped|planned|opt-in|advisory|critical" /> for MDX and the sidebar (work package D1).
// Colours come from the existing .chip classes. Planned is dashed and says the word, so it never reads as shipped.
import type { ReactNode } from "react";
import s from "./DocsMdx.module.css";

export type StatusKind = "shipped" | "planned" | "opt-in" | "advisory" | "critical";

const KIND: Record<StatusKind, string> = {
  shipped: "c-pass",
  planned: s.planned,
  "opt-in": `c-inconclusive ${s.optin}`,
  advisory: `c-na ${s.advisory}`,
  critical: "c-fail",
};

export function Status({ kind, children }: { kind: StatusKind; children?: ReactNode }) {
  return <span className={clsx("chip", s.status, KIND[kind] ?? KIND.shipped)}>{children ?? kind}</span>;
}
