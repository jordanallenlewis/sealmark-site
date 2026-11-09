"use client";
import { clsx } from "clsx";
import { useId, useState, type CSSProperties } from "react";
import { RANK, letterFor, type Letter } from "@/lib/data";
import s from "./GradeLadder.module.css";

// Same rule as gradePack() in lib/data.ts and cli/src/grade.ts: bands come from letterFor (not copied here),
// a critical fail turns a raw A, B or C into D, a raw D or F is left alone, and an inconclusive critical
// check only marks the grade provisional. A partial on a critical check is not a fail, so it never caps.
const ORDER: Letter[] = ["A", "B", "C", "D", "F"];
const BAND: Record<Letter, string> = { A: "90% and up", B: "75–89%", C: "60–74%", D: "45–59%", F: "under 45%" };
const ROW = 52; // px, keep in sync with --row in the CSS module
const TICKS = [45, 60, 75, 90];

export function GradeLadder({ auto = true }: { auto?: boolean }) {
  const [pct, setPct] = useState(80);
  const [critFail, setCritFail] = useState(true);
  const [critInc, setCritInc] = useState(false);
  const mid = useId();

  const raw = letterFor(pct / 100);
  const capped = critFail && RANK[raw] < RANK.D;
  const final: Letter = capped ? "D" : raw;
  const rawIdx = ORDER.indexOf(raw);
  const dIdx = ORDER.indexOf("D");

  const main = capped ? `raw ${raw} → final D` : `final ${raw}`;
  const tags = [
    capped ? "capped" : critFail ? `${raw} stays ${raw}, the cap only lowers a better grade` : "",
    critInc ? "provisional *" : "",
  ].filter(Boolean);
  const readout = [main, ...tags].join(" · ");

  const y = (i: number) => i * ROW + ROW / 2;

  return (
    <figure className={s.fig} aria-label="Grade ladder: move the scored percentage and toggle a critical failure to see the letter and the cap" data-auto={auto}>
      <div className={s.grid}>
        <div className={s.ctl}>
          <label className={s.slider} style={{ "--p": `${pct}%` } as CSSProperties}>
            <span className={s.lab}>
              <span>scored percentage</span>
              <b className="mono">{pct}%</b>
            </span>
            <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-valuetext={`${pct} percent, raw grade ${raw}`} />
            <span className={s.ticks} aria-hidden="true">
              {TICKS.map((t) => (
                <i key={t} style={{ left: `calc(${t}% + ${(0.5 - t / 100) * 18}px)` }}>{t}</i>
              ))}
            </span>
          </label>

          <div className={s.togs}>
            <label className={s.tog}>
              <input type="checkbox" checked={critFail} onChange={(e) => setCritFail(e.target.checked)} />
              <span>
                <b>a critical check failed</b>
                <small className="mono">better than D becomes D</small>
              </span>
            </label>
            <label className={s.tog}>
              <input type="checkbox" checked={critInc} onChange={(e) => setCritInc(e.target.checked)} />
              <span>
                <b>a critical check inconclusive</b>
                <small className="mono">the grade gets a *</small>
              </span>
            </label>
          </div>

          <div className={s.read} aria-live="polite">
            <span className={clsx("seal lg", `g-${final}`, critInc && "prov")} role="img" aria-label={`Grade ${final}${critInc ? ", provisional" : ""}`}>{final}</span>
            <span className={`${s.line} mono`} data-capped={capped}>{readout}</span>
          </div>
        </div>

        <div className={s.wrap}>
          <ol className={s.ladder} aria-label="Grade bands">
            {ORDER.map((L) => (
              <li key={L} className={s.row} data-final={L === final} data-raw={capped && L === raw}>
                <span className={clsx("seal", `g-${L}`, L === final && critInc && "prov")} aria-hidden="true">{L}</span>
                <span className={`${s.band} mono`}>{BAND[L]}</span>
                <span className={`${s.mark} mono`}>{L === final ? (capped ? "final · capped" : "final") : capped && L === raw ? "raw" : ""}</span>
              </li>
            ))}
          </ol>
          <svg className={s.cap} viewBox={`0 0 44 ${ORDER.length * ROW}`} width="44" height={ORDER.length * ROW} aria-hidden="true" focusable="false">
            <defs>
              <marker id={mid} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill="var(--fail)" />
              </marker>
            </defs>
            {capped && (
              <path key={raw} className={s.arrow} pathLength={1} d={`M3 ${y(rawIdx)} C 40 ${y(rawIdx)}, 40 ${y(dIdx)}, 8 ${y(dIdx)}`} markerEnd={`url(#${mid})`} />
            )}
          </svg>
        </div>
      </div>
    </figure>
  );
}
