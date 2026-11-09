import type { CSSProperties } from "react";
import Link from "next/link";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, RANK, SERVERS_RESULTS, deepPacks, worst, type Letter, type ServerResult } from "@/lib/results";
import s from "./ResultsTicker.module.css";
import { TickerControl } from "./TickerControl";

const short = (n: string) => n.replace(/^@[^/]+\//, "");

function Set({ list, hidden }: { list: ServerResult[]; hidden?: boolean }) {
  return (
    <div className={s.set} aria-hidden={hidden || undefined}>
      {list.map((x) => {
        const w = worst(x);
        const deep = deepPacks(x);
        return (
          <Link key={x.id} className={s.item} href={`/results/${x.id}/`} tabIndex={hidden ? -1 : undefined}>
            <span>{w ? <Seal g={w.letter as Letter} prov={w.provisional} /> : null}</span>
            <span className={s.name}>{short(x.name)}</span>
            <span className={s.sub}>{deep.length ? deep.map((p) => `${(PACK_LABEL[p.id] ?? p.id).toLowerCase()} ${p.letter}`).join(" · ") : "protocol only"}</span>
          </Link>
        );
      })}
    </div>
  );
}

// "Tested on" ticker: two slow rows of every tested server with its worst grade, drifting in opposite directions.
// Not "used by": these are servers Sealmark was run against, not customers. Each item links to its evidence page.
export function ResultsTicker() {
  const sorted = [...SERVERS_RESULTS].sort((a, b) => {
    const wa = worst(a), wb = worst(b);
    return (wa ? RANK[wa.letter] : 5) - (wb ? RANK[wb.letter] : 5) || a.name.localeCompare(b.name);
  });
  // Interleave best and worst so every part of each row mixes grades (sorted is worst first).
  const mixed = sorted.map((_, i) => (i % 2 === 0 ? sorted[i / 2] : sorted[sorted.length - 1 - (i - 1) / 2]));
  const half = Math.ceil(mixed.length / 2);
  const row1 = mixed.slice(0, half);
  const row2 = mixed.slice(half);
  return (
    <TickerControl>
    <figure className={s.ticker} aria-label={`Worst grade for each of the ${sorted.length} servers tested`}>
      <div className={s.row} style={{ "--n": row1.length } as CSSProperties}><Set list={row1} /><Set list={row1} hidden /></div>
      <div className={`${s.row} ${s.rev}`} style={{ "--n": row2.length } as CSSProperties}><Set list={row2} /><Set list={row2} hidden /></div>
    </figure>
    </TickerControl>
  );
}
