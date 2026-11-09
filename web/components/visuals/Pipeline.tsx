"use client";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { PlayPause } from "@/components/PlayPause";
import { useAutoplay } from "./useAutoplay";
import s from "./Pipeline.module.css";
import { HOLD_MS } from "./motion";

/* ------------------------------------------------------------------------------------------
   Content. Matches cli/src/run.ts: the server is started once for the core suite (and to read its
   tools), then once per database role for the database suite; the database suite seeds a synthetic Postgres first.
------------------------------------------------------------------------------------------ */
const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

// A window with n horizontal rows: n = 1 is one server start, n = 3 is one per role (the rows of the seal).
const Starts = ({ n }: { n: 1 | 3 }) => (
  <Ico>
    <rect x="4" y="5" width="20" height="18" rx="3" />
    {n === 1 ? <path d="M9 14h10" /> : <path d="M9 10h10M9 14h10M9 18h10" />}
  </Ico>
);

type Step = { id: string; label: string; tag?: string; sub: string[]; icon: ReactNode; words: string };

const STEPS: Step[] = [
  {
    id: "config",
    label: "sealmark.yaml",
    sub: ["your server", "command or URL"],
    icon: (
      <Ico>
        <path d="M8 4h8l5 5v15H8z" />
        <path d="M16 4v5h5M11 14h7M11 18h7" />
      </Ico>
    ),
    words: "Read sealmark.yaml: the command or URL that starts your server, and which test suites to run.",
  },
  {
    id: "core",
    label: "start ×1",
    tag: "core",
    sub: ["any MCP server"],
    icon: <Starts n={1} />,
    words: "Start your server once for the core suite, and read its tool list.",
  },
  {
    id: "db",
    label: "start ×3",
    tag: "db",
    sub: ["analyst", "support", "admin"],
    icon: <Starts n={3} />,
    words: "For the database suite, a seeded synthetic Postgres is started first. Then your server is started once per database role (analyst, support and admin), plus a fresh start for the timeout probe.",
  },
  {
    id: "probe",
    label: "probe",
    sub: ["fixed calls", "no model"],
    icon: (
      <Ico>
        <path d="M15 3L7 16h6l-1 9 9-14h-6z" />
      </Ico>
    ),
    words: "Call the server's tools directly with fixed inputs. No language model is involved.",
  },
  {
    id: "observe",
    label: "observe",
    sub: ["db-state", "response"],
    icon: (
      <Ico>
        <path d="M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14z" />
        <circle cx="14" cy="14" r="3.2" />
      </Ico>
    ),
    words: "Decide each verdict from what the harness sees: for database checks it reads the database itself, over a separate connection; otherwise it uses what the server returned.",
  },
  {
    id: "grade",
    label: "grade",
    sub: ["letter per suite"],
    icon: (
      <Ico>
        <circle cx="14" cy="14" r="11" strokeDasharray="3 2.4" />
        <circle cx="14" cy="14" r="7" />
        <path d="M11 12h6M11 16h6" />
      </Ico>
    ),
    words: "Apply the published formula to get one letter per suite. A failed critical check caps the grade at D.",
  },
  {
    id: "record",
    label: "record",
    sub: ["--format json --out <file>", "--fail-under B"],
    icon: (
      <Ico>
        <path d="M8 4h8l5 5v15H8z" />
        <path d="M16 4v5h5" />
        <path d="M12.5 13.5c-1.2 0-1.5.6-1.5 1.5s0 1.5-1 1.9c1 .4 1 .9 1 1.9s.3 1.5 1.5 1.5M16.5 13.5c1.2 0 1.5.6 1.5 1.5s0 1.5 1 1.9c-1 .4-1 .9-1 1.9s-.3 1.5-1.5 1.5" />
      </Ico>
    ),
    words: "Print the report, with the exact configuration and the evidence for every probe; --format json --out <file> writes it to a file. With --fail-under B the command exits 1 when a graded suite is below B.",
  },
];

// Home variant: four nodes. The two start nodes (core, db) merge into one "start" node.
// Plain words on the home page: no suite names (the docs variant keeps them).
const COMPACT_IDS = ["core", "probe", "observe", "grade"];
const COMPACT_SUBS: Record<string, string[]> = {
  core: ["your server"],
  probe: ["fixed tool calls"],
  observe: ["read the database"],
  grade: ["one letter,", "evidence attached"],
};
const COMPACT_STEPS: Step[] = STEPS.filter((st) => COMPACT_IDS.includes(st.id)).map((st) =>
  st.id === "core"
    ? { ...st, label: "start", tag: undefined, sub: COMPACT_SUBS.core, icon: <Starts n={3} />, words: "Start your server: once for the core suite, and once per database role for the database suite." }
    : { ...st, sub: COMPACT_SUBS[st.id] },
);

const ADVANCE_MS = 700; // one node lights per frame
const DEFAULT_CAPTION = "One start for core, one per role for db (plus a fresh start for the timeout probe). Fixed probes, no model.";
const COMPACT_CAPTION = "No model in the loop.";

export function Pipeline({ auto = true, compact = false, caption }: { auto?: boolean; compact?: boolean; caption?: string }) {
  const steps = compact ? COMPACT_STEPS : STEPS;
  const REST = steps.length; // all nodes done: the finished frame, and what server render and reduced motion show
  const FRAMES = steps.length + Math.ceil(HOLD_MS / ADVANCE_MS); // one frame per node, then rest on the finished state (compact: 8 x 0.7 s, 2.8 s hold)
  const ref = useRef<HTMLElement>(null);
  const { status, reduced, frame, setFrame, pause, toggle } = useAutoplay(ref, { loopMs: ADVANCE_MS, frames: FRAMES, auto });
  // One state decides what shows: paused-auto (offscreen, reduced motion, server render) rests on the finished frame;
  // playing and paused-user show the current frame.
  const at = status === "paused-auto" ? REST : Math.min(frame, REST);
  const pick = (n: number) => {
    pause(); // a dot click pauses on the chosen frame until the user presses play
    setFrame(n);
  };
  const label = compact
    ? `What one sealmark run does: ${steps.map((n) => n.label).join(", ")}`
    : "What one sealmark run does: read the config, start the server once for core and once per role for db, probe, observe, grade, record";

  return (
    <figure ref={ref} className={s.fig} data-compact={compact} data-state={status} aria-label={label}>
      <ol className={s.track} aria-hidden="true" style={{ "--n": steps.length } as CSSProperties}>
        {steps.map((n, i) => (
          <li key={n.id} className={s.node} data-state={i < at ? "done" : i === at ? "active" : "todo"}>
            <span className={s.ico}>{n.icon}</span>
            <span className={s.txt}>
              <b>{n.label}</b>
              {n.tag && <i className={s.tag}>{n.tag}</i>}
              {n.sub.map((t) => (
                <small key={t}>{t}</small>
              ))}
            </span>
          </li>
        ))}
      </ol>

      <div className={s.ctl} role="group" aria-label="Pipeline step" data-reduced={reduced}>
        <PlayPause paused={status === "paused-user"} onToggle={toggle} hidden={!auto || reduced} className={s.pp} />
        {steps.map((n, i) => (
          <button key={n.id} type="button" className={s.dot} aria-label={`Show step ${i + 1}: ${n.label}${n.tag ? " " + n.tag : ""}`} aria-current={at === i ? "step" : undefined} onClick={() => pick(i)} />
        ))}
        <button type="button" className={s.txtbtn} aria-label="Show all steps done" aria-current={at === REST ? "step" : undefined} onClick={() => pick(REST)}>all</button>
      </div>

      <figcaption className={s.cap}>{caption ?? (compact ? COMPACT_CAPTION : DEFAULT_CAPTION)}</figcaption>

      <ol className="sr-only">
        {steps.map((n) => (
          <li key={n.id}>{n.words}</li>
        ))}
      </ol>
    </figure>
  );
}
