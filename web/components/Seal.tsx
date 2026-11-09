import { clsx } from "clsx";
import type { Letter } from "@/lib/data";

export function Seal({ g, prov, lg }: { g: Letter; prov?: boolean; lg?: boolean }) {
  return (
    <span className={clsx("seal", `g-${g}`, lg && "lg", prov && "prov")} role="img" aria-label={`Grade ${g}${prov ? ", provisional" : ""}`}>
      {g}
    </span>
  );
}
