"use client";
import { clsx } from "clsx";
// (e) RoleLanes: one server, three database roles, before/after.
// Teaches: the database suite starts the server once per role and watches what each role can see.
// rls and pii are database controls tested through the server (verified: response);
// read-only is verified from database state. Invented example: no real server is shown.
// First paint is the finished state (role DSN, all lanes filled). Motion starts after mount, only
// when the figure is at least 40% visible and html.reduce is not set.
import { useEffect, useId, useRef, useState } from "react";
import { gradePack, type Verdict } from "@/lib/data";
import s from "./RoleLanes.module.css";

type Mode = "role" | "admin";

// The grades come from the real formula in data.ts, not from hard-coded letters.
const R = { "read-only": "pass", "write-gate": "na", rls: "pass", "mutating-sql": "pass", pii: "pass", "pii-masked": "pass", "db-rowcap": "pass", "db-timeout": "pass", audit: "na", "db-privilege": "pass" } as const;
const mk = (r: Record<string, Verdict>) => ({ r });
const GOOD = gradePack("db", mk({ ...R }))!;
const OWNER = gradePack("db", mk({ ...R, rls: "fail", pii: "fail" }))!;

type Lane = {
  role: "analyst" | "support" | "admin";
  check: string;
  crit: boolean;
  by: "response" | "db-state";
  sql: string;
  leakAt: number; // ownerStep at which the pinned-admin outcome shows (0 = never leaks)
  clean: { text: string; hint: string };
  leak?: { text: string; hint: string };
};

// Probes and sentinels are the real ones from docs/methodology.md (sections 5, 6.3, 6.5).
const LANES: Lane[] = [
  {
    role: "analyst", check: "pii", crit: true, by: "response", sql: "SELECT email FROM customers", leakAt: 1,
    clean: { text: "permission denied for table customers", hint: "a masked view would return c***@example.test: also clean" },
    leak: { text: "cust1001@example.test", hint: "raw address returned to the analyst role" },
  },
  {
    role: "support", check: "rls", crit: true, by: "response", sql: "SELECT * FROM orders", leakAt: 2,
    clean: { text: "T1-NOTE-order-1 …", hint: "only the support role's own tenant came back" },
    leak: { text: "T2-SECRET-order-51 …", hint: "T2-SECRET marks the other tenant's rows" },
  },
  {
    role: "admin", check: "read-only", crit: false, by: "db-state", sql: "INSERT INTO probe_t (id, v) VALUES (9001, 'sm-insert')", leakAt: 0,
    clean: { text: "isError: only read statements", hint: "state reader: probe_t has 0 rows" },
  },
];

const isReduce = () => typeof document !== "undefined" && document.documentElement.classList.contains("reduce");

export function RoleLanes({ auto = true }: { auto?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const connId = useId();
  const fill = useRef<number[]>([]);
  const flip = useRef<number[]>([]);
  const touched = useRef(false);
  const [mode, setMode] = useState<Mode>("role");
  const [ownerStep, setOwnerStep] = useState(0); // 0 clean, 1 analyst leak, 2 support leak, 3 grade shown
  const [shown, setShown] = useState(3); // lanes filled so far
  const [pop, setPop] = useState(false);

  const clearFlip = () => { flip.current.forEach(clearTimeout); flip.current = []; };
  const clearFill = () => { fill.current.forEach(clearTimeout); fill.current = []; };

  const go = (next: Mode, animate: boolean) => {
    clearFlip();
    setMode(next);
    if (next === "role") { setOwnerStep(0); setPop(false); return; }
    if (!animate || isReduce()) { setOwnerStep(3); return; }
    setOwnerStep(1);
    flip.current.push(window.setTimeout(() => setOwnerStep(2), 300));
    flip.current.push(window.setTimeout(() => { setOwnerStep(3); setPop(true); }, 700));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !auto || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      if (isReduce()) return;
      setShown(0);
      [250, 850, 1450].forEach((t, i) => fill.current.push(window.setTimeout(() => setShown(i + 1), t)));
      fill.current.push(window.setTimeout(() => { if (!touched.current) go("admin", true); }, 4000));
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); clearFill(); clearFlip(); };
    // go only touches refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const pick = (m: Mode) => { touched.current = true; clearFill(); setShown(3); go(m, true); };

  const g = ownerStep >= 3 ? OWNER : GOOD;
  const capped = g.capped;

  return (
    <figure className={s.fig} ref={ref} aria-label="Three database roles, one server: what the analyst, support and admin roles can see, with the server connecting as each requested role or as sm_admin for every role. Invented example.">
      <div className={s.top}>
        <div className={s.conn}>
          <span className={s.lab} id={connId}>server connects as</span>
          <div className={s.seg} role="group" aria-labelledby={connId}>
            <button type="button" aria-pressed={mode === "role"} onClick={() => pick("role")}>role DSN</button>
            <button type="button" aria-pressed={mode === "admin"} onClick={() => pick("admin")}>admin DSN</button>
          </div>
          <p className={s.gloss}>
            {mode === "role"
              ? "{dsn} resolves to the role under test, so the database's policy and grants apply."
              : "The server connects as sm_admin for every role, so the policy and grants never apply."}
          </p>
        </div>
        <div className={s.grade} aria-live="polite">
          <span key={g.letter} className={clsx("seal lg", `g-${g.letter}`, pop && capped && s.pop)} role="img" aria-label={capped ? `Grade ${g.letter}, capped from ${g.raw}` : `Grade ${g.letter}`}>{g.letter}</span>
          <div className={s.gtext}>
            <b>database suite · grade {g.letter}</b>
            <span>
              {g.points} of {g.scored} scored checks pass · {Math.round(g.pct * 100)}%
              {capped ? <> · raw {g.raw}, <em className={s.cap}>capped</em> at D by a critical fail</> : null}
            </span>
          </div>
        </div>
      </div>

      <div className={s.lanes}>
        {LANES.map((l, i) => {
          const leaking = !!l.leak && ownerStep >= l.leakAt;
          const out = leaking ? l.leak! : l.clean;
          return (
            <div key={l.role} className={`win ${s.lane}`} data-on={shown > i} data-leak={leaking} data-role={l.role}>
              <div className="winbar"><i /><i /><i /><span>sm_{l.role} · check {l.check}</span></div>
              <div className={s.body}>
                <div className={s.who}>
                  <b>{l.role}</b>
                  <span>{l.check}{l.crit ? " · critical" : " · not critical"}</span>
                </div>
                <div className={s.probe}>
                  <span className={s.lab}>probe</span>
                  <code>{l.sql}</code>
                </div>
                <svg className={s.arrow} viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M1 6h20M16 1.5 21.5 6 16 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div className={s.resp}>
                  <span className={s.lab}>{l.by === "response" ? "response" : "response, then database state"}</span>
                  <code className={s.val}>{out.text}</code>
                  <span className={s.hint}>{out.hint}</span>
                </div>
                <div className={s.verdict}>
                  <span className={clsx("chip", leaking ? "c-fail" : "c-pass")}>
                    {leaking ? `fail · ${l.check}${l.crit ? " · critical" : ""}` : `pass · ${l.check}`}
                  </span>
                  {leaking && <span className={s.leakword}>✕ leak</span>}
                  <span className={s.by}>verified: {l.by}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className={s.rest}>mutating-sql, pii-masked, db-rowcap and db-timeout also ran; all four pass in either case. The admin lane does not change because this example server still refuses writes when pinned to the admin DSN. A server that connects as the table owner is reported inconclusive instead, because the admin control read fails.</p>

      <figcaption className={s.cap2}>
        A pass means the server did not defeat the database&apos;s policy or grant; it does not mean the server masks anything. Invented example, not a real server.
      </figcaption>
      <ol className="sr-only">
        <li>The harness starts the server once per database role: analyst, support and admin.</li>
        <li>Analyst runs SELECT email FROM customers. Support runs SELECT * FROM orders. Admin runs an INSERT into probe_t.</li>
        <li>With the role connection string, the analyst gets permission denied, support sees only its own tenant, and the INSERT leaves probe_t with 0 rows. All three pass.</li>
        <li>With the admin connection string used for every role, the analyst receives the raw address cust1001@example.test and support receives T2-SECRET rows. Both are verified from the response and both are critical fails.</li>
        <li>Two critical fails cap the database suite at D: {OWNER.points} of {OWNER.scored} points, a raw {OWNER.raw}.</li>
      </ol>
    </figure>
  );
}
