import type { CSSProperties } from "react";
import Link from "next/link";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, RANK, SERVERS_RESULTS, deepPacks, worst, type Letter, type ServerResult } from "@/lib/results";
import { balanceGoodBad, goodBadRows } from "@/lib/ticker-mix.mjs";
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
          <Link key={x.id} className={s.item} href={`/results/${x.id}/`} tabIndex={-1}>
            <span>{w ? <Seal g={w.letter as Letter} prov={w.provisional} /> : null}</span>
            <span className={s.name}>{short(x.name)}</span>
            <span className={s.sub}>{deep.length ? deep.map((p) => `${(PACK_LABEL[p.id] ?? p.id).toLowerCase()} ${p.letter}`).join(" · ") : "protocol only"}</span>
          </Link>
        );
      })}
    </div>
  );
}

// "Tested on" ticker: two slow rows of tested servers with their worst grade, drifting in opposite directions.
// Not "used by": these are servers Sealmark was run against, not customers. Each item links to its evidence page.
// A sample, not every server: every server graded C, D or F and as many graded A or B (lib/ticker-mix.mjs), so the
// ticker shows what failing looks like as often as passing. "See all results" below it has the full list and counts.
// Items are out of the tab order; keyboard users go on to "See all results".
export function ResultsTicker() {
  const sorted = [...SERVERS_RESULTS].sort((a, b) => {
    const wa = worst(a), wb = worst(b);
    return (wa ? RANK[wa.letter] : 5) - (wb ? RANK[wb.letter] : 5) || a.name.localeCompare(b.name);
  });
  const shown = balanceGoodBad(sorted, (x) => worst(x)?.letter);
  // Good and bad split evenly between the rows and alternating along each row, letters varied within each side.
  const [row1, row2] = goodBadRows(shown, (x) => worst(x)?.letter);
  return (
    <TickerControl>
    <figure className={s.ticker} aria-label={`Worst grade for ${shown.length} of the ${sorted.length} servers tested: every one graded C, D or F and as many graded A or B`}>
      <div className={s.row} style={{ "--n": row1.length } as CSSProperties}><Set list={row1} /><Set list={row1} hidden /></div>
      <div className={`${s.row} ${s.rev}`} style={{ "--n": row2.length } as CSSProperties}><Set list={row2} /><Set list={row2} hidden /></div>
    </figure>
    </TickerControl>
  );
}
