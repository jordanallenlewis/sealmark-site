// <Planned label="…"> wraps a block that describes something designed but not built:
// dashed frame, a ribbon with the word, and no copy buttons inside (work package D1).
import type { ReactNode } from "react";
import s from "./DocsMdx.module.css";

export function Planned({ children, label = "planned, not available" }: { children: ReactNode; label?: string }) {
  return (
    <div className={s.plannedBlock} role="group" aria-label="Planned, not built">
      <span className={s.ribbon}>{label}</span>
      {children}
    </div>
  );
}
