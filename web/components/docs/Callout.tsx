import { clsx } from "clsx";
// <Callout kind="note|warn" title="…"> for MDX (work package D1).
import type { ReactNode } from "react";
import s from "./DocsMdx.module.css";

export function Callout({ kind = "note", title, children }: { kind?: "note" | "warn"; title?: string; children: ReactNode }) {
  return (
    <aside className={clsx(s.callout, kind === "warn" && s.warn)} role="note">
      <span className={s.calloutTitle}>{title ?? (kind === "warn" ? "Warning" : "Note")}</span>
      {children}
    </aside>
  );
}
