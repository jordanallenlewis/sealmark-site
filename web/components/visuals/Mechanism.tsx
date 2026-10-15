"use client";
import { Fragment, useId, useRef, type CSSProperties } from "react";
import s from "./Mechanism.module.css";
import { Logo } from "@/components/Logo";
import { useAutoplay } from "./useAutoplay";

// Hero canvas: the harness does not trust the server, it reads Postgres itself.
// Three cases loop (read-only pass, read-only fail, rls fail with the D cap). The invented example is
// labelled as such in the caption. Where a check can be verified in the database the label says
// `verified: db-state`; rls and pii are verified from the response, so case 3 says `verified: response`
// and the harness does not touch the table (this matches cli/src/packs/db.ts).

// ---- timeline (ms from the start of a case; each case lasts CASE_MS including the hold) ----
const CASE_MS = 9000;
const T = { probe: 0, sql: 800, resp: 1600, read: 2400, result: 3500, verdict: 4200, stamp: 4900 } as const;

// ---- geometry: wires in viewBox units. Desktop = sequence diagram, mobile = vertical flow ----
type Geo = {
  w: number; h: number;
  life: string[];
  m1: { d: string; head: string; dot: [number, number]; to: [number, number] };
  m2: { d: string; head: string; dot: [number, number]; to: [number, number] };
  m3: { d: string; head: string; dot: [number, number]; to: [number, number] };
  m4: { d: string; head: string };
};
const DESK: Geo = {
  w: 640, h: 440,
  life: ["M90 104V338", "M320 104V338", "M550 104V338"],
  m1: { d: "M98 140H302", head: "302,135 312,140 302,145", dot: [98, 140], to: [206, 0] },
  m2: { d: "M328 180H532", head: "532,175 542,180 532,185", dot: [328, 180], to: [204, 0] },
  m3: { d: "M312 220H108", head: "108,215 98,220 108,225", dot: [312, 220], to: [-204, 0] },
  m4: { d: "M90 262C200 350 440 350 550 262", head: "550,262 543.7,273.4 537.5,265.6" },
};
const MOB: Geo = {
  w: 360, h: 560,
  life: [],
  m1: { d: "M40 80V164", head: "35,164 40,174 45,164", dot: [40, 80], to: [0, 84] },
  m2: { d: "M40 252V340", head: "35,340 40,350 45,340", dot: [40, 252], to: [0, 88] },
  m3: { d: "M186 168V84", head: "181,84 186,74 191,84", dot: [186, 168], to: [0, -84] },
  m4: { d: "M222 40H306Q342 40 342 76V387Q342 423 306 423H232", head: "232,418 222,423 232,428" },
};

// ---- the three cases ----
type Case = {
  name: string;          // short, for the dots
  title: string;        // accessible name of the dot
  role: "admin" | "support";
  sql: string;           // what the harness sends through the server's SQL tool
  resp: { val: string; tone: "warn" | "bad" };
  reader: "db-state" | "response";
  row?: string;          // the row that appears in probe_t (case 2 only)
  result: { text: string; tone: "ok" | "bad" | "faint" };
  verdict: { tone: "pass" | "fail"; text: string };
  note?: string;
  capped?: boolean;
  sr: string;
};
const CASES: Case[] = [
  {
    name: "read-only passes",
    title: "Case 1 of 3: the read-only check passes",
    role: "admin",
    sql: "INSERT INTO probe_t …",
    resp: { val: '"ok"', tone: "warn" },
    reader: "db-state",
    result: { text: "0 rows", tone: "ok" },
    verdict: { tone: "pass", text: "pass · read-only" },
    sr: 'Case 1, read-only passes. The harness, acting as the admin role, calls the server\'s query tool with an INSERT into probe_t. The server answers "ok". The harness then reads probe_t itself over its own database connection and finds 0 rows. Verdict: pass, verified from the database state.',
  },
  {
    name: "read-only fails",
    title: "Case 2 of 3: the read-only check fails",
    role: "admin",
    sql: "INSERT INTO probe_t …",
    resp: { val: '"ok"', tone: "warn" },
    reader: "db-state",
    row: "9001 sm-insert",
    result: { text: "1 row", tone: "bad" },
    verdict: { tone: "fail", text: "fail · read-only" },
    note: "not critical · no cap",
    sr: 'Case 2, read-only fails. The same probe, a different server. The server also answers "ok", but when the harness reads probe_t itself it finds the new row 9001 sm-insert. Verdict: fail, verified from the database state. Read-only is not a critical check, so there is no grade cap.',
  },
  {
    name: "rls fails",
    title: "Case 3 of 3: the row-level security check fails",
    role: "support",
    sql: "SELECT * FROM orders",
    resp: { val: "T2-SECRET", tone: "bad" },
    reader: "response",
    result: { text: "not read here", tone: "faint" },
    verdict: { tone: "fail", text: "fail · rls · critical" },
    capped: true,
    sr: "Case 3, row-level security fails. The harness, acting as the support role, asks the server for SELECT * FROM orders. The response contains T2-SECRET, a row that belongs to another tenant. Verdict: fail, verified from the response; the harness does not read the table for this check. Row-level security is a critical check, so the grade is capped at D.",
  },
];

const at = (ms: number, extra?: Record<string, string>): CSSProperties => ({ "--at": `${ms}ms`, ...extra }) as CSSProperties;
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

function Seal() {
  return <Logo className={s.seal} />;
}

// Lifelines never change between cases, so they live in the persistent layer and do not blink at the case boundary.
function Lifelines({ g, className }: { g: Geo; className: string }) {
  return (
    <svg className={cx(s.svg, className)} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false">
      {g.life.map((d) => <path key={d} className={s.life} d={d} />)}
    </svg>
  );
}

// The wires: arrows, travelling probe dots and the gold state-reader line. Decorative.
function Wires({ g, c, uid, className }: { g: Geo; c: Case; uid: string; className: string }) {
  const tone = c.resp.tone;
  const dotVars = (m: Geo["m1"], ms: number, cls?: string) => (
    <circle className={cx(s.dot, cls)} cx={m.dot[0]} cy={m.dot[1]} r={4.5} style={at(ms, { "--dx": `${m.to[0]}px`, "--dy": `${m.to[1]}px` })} />
  );
  return (
    <svg className={cx(s.svg, className)} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false">
      <path className={cx(s.wire, s.ev)} style={at(T.probe)} d={g.m1.d} />
      <polygon className={cx(s.head, s.ev)} style={at(T.probe)} points={g.m1.head} />
      {dotVars(g.m1, T.probe)}
      <path className={cx(s.wire, s.ev)} style={at(T.sql)} d={g.m2.d} />
      <polygon className={cx(s.head, s.ev)} style={at(T.sql)} points={g.m2.head} />
      {dotVars(g.m2, T.sql)}
      <path className={cx(s.wire, s.dash, s.ev, s[tone])} style={at(T.resp)} d={g.m3.d} />
      <polygon className={cx(s.head, s.ev, s[tone])} style={at(T.resp)} points={g.m3.head} />
      {dotVars(g.m3, T.resp, tone === "bad" ? s.dotBad : s.dotWarn)}
      {c.reader === "db-state" && (
        <>
          <mask id={`${uid}m`} maskUnits="userSpaceOnUse" x={0} y={0} width={g.w} height={g.h}>
            <path className={s.maskPath} style={at(T.read)} d={g.m4.d} pathLength={1} />
          </mask>
          <path className={s.gold} d={g.m4.d} mask={`url(#${uid}m)`} />
          <polygon className={cx(s.goldHead, s.ev)} style={at(T.read + 800)} points={g.m4.head} />
        </>
      )}
    </svg>
  );
}

export function Mechanism({ auto = true, caption = "Example data: servers and results are invented." }: { auto?: boolean; caption?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { playing, frame, setFrame } = useAutoplay(wrapRef, { loopMs: CASE_MS, frames: CASES.length, auto });
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const c = CASES[frame];

  return (
    <figure className={s.fig} aria-label="How the harness grades one check: it calls the server, then reads the database itself">
      <div className={s.wrap} ref={wrapRef}>
        {/* The stage persists: cards and lifelines stay put. Only the layer below is keyed by case, so each case
            restarts its own timeline and fades out at the end instead of the whole stage resetting.
            .play exists only while motion is allowed and the figure is on screen. */}
        <div className={cx(s.stage, playing && s.play)} style={{ "--case": `${CASE_MS}ms` } as CSSProperties} aria-live="off">
          <Lifelines g={DESK} className={s.svgD} />
          <Lifelines g={MOB} className={s.svgM} />

          <div className={cx(s.card, s.cH)}>
            <Seal />
            <div className={s.hText}><span className={s.nTitle}>harness</span><span className={s.nSub}>as <b><span key={c.role} className={s.swap}>{c.role}</span></b></span></div>
          </div>
          <div className={cx(s.card, s.cS)}>
            <span className={s.nTitle}>server under test</span>
            <span className={s.nSub}>query{"{sql}"}</span>
          </div>
          <div className={cx(s.card, s.cP, c.reader === "response" && s.dim)}>
            <span className={s.nTitle}>postgres</span>
            <div className={s.tbl}>
              <div className={s.th}>probe_t <i>id · v</i></div>
              <div className={s.slotBox}>
                <div className={s.slotEmpty}>empty</div>
                {c.row && <div key={frame} className={cx(s.slotFill)} style={at(T.result)}>{c.row}</div>}
              </div>
            </div>
          </div>

          <Fragment key={frame}>
            <div className={s.layer}>
              <Wires g={DESK} c={c} uid={`${uid}d`} className={s.svgD} />
              <Wires g={MOB} c={c} uid={`${uid}n`} className={s.svgM} />

              <span className={cx(s.at, s.ctr, s.lbl, s.lblProbe, s.ev)} style={at(T.probe)}>tools/call query</span>
              <span className={cx(s.at, s.ctr, s.lbl, s.lblSql, s.ev)} style={at(T.sql)}>{c.sql}</span>
              <span className={cx(s.at, s.ctr, s.lbl, s.pill, c.resp.tone === "bad" ? s.pillBad : s.pillWarn, s.lblResp, s.popIn)} style={at(T.resp)}>response: <span className={s.nw}>{c.resp.val}</span></span>
              {c.reader === "db-state" && (
                <>
                  <span className={cx(s.at, s.ctr, s.lbl, s.lblGold, s.lblReader, s.ev)} style={at(T.read)}>state reader</span>
                  <span className={cx(s.at, s.ctr, s.lbl, s.lblFaint, s.lblSelect, s.ev)} style={at(T.read + 200)}>SELECT … FROM probe_t</span>
                </>
              )}
              <span className={cx(s.at, s.ctr, s.lbl, s.lblResult, s.popIn, c.result.tone === "ok" && s.rOk, c.result.tone === "bad" && s.rBad, c.result.tone === "faint" && s.lblFaint)} style={at(T.result)}>{c.result.text}</span>

              <div className={s.verdict}>
                <span className={cx("chip", c.verdict.tone === "pass" ? "c-pass" : "c-fail", s.popIn)} style={at(T.verdict)}>{c.verdict.text}</span>
                <div className={s.vmeta}>
                  <span className={s.ev} style={at(T.verdict + 200)}>verified: <b>{c.reader}</b></span>
                  {c.note && <span className={s.ev} style={at(T.verdict + 400)}>{c.note}</span>}
                </div>
              </div>
              {c.capped && (
                <div className={s.stamp} style={at(T.stamp)}><b>D</b><small>capped</small></div>
              )}
            </div>
          </Fragment>
        </div>
      </div>

      <div className={s.ctrl}>
        <div className={s.dots} role="group" aria-label="Example cases">
          {CASES.map((k, i) => (
            <button key={k.name} type="button" aria-label={k.title} aria-current={i === frame} onClick={() => setFrame(i)}><span /></button>
          ))}
        </div>
        <span className={s.caseName}>case {frame + 1} of {CASES.length} · <b>{c.name}</b></span>
      </div>
      <figcaption className={s.cap}>{caption}</figcaption>
      <ol className="sr-only">
        {CASES.map((k) => <li key={k.name}>{k.sr}</li>)}
      </ol>
    </figure>
  );
}
