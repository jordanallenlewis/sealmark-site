"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Seal } from "@/components/Seal";
import { MAX_INPUT, fragmentBytes, parseReport, type ViewRun } from "@/lib/report-view.mjs";
import s from "./report.module.css";

// One status for the whole flow (web/AGENTS.md): idle -> loading -> ready | error. data-state on the root carries it.
type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; runs: ViewRun[]; failed: { server: string }[]; source: string }
  | { phase: "error"; message: string };

const WORD = { pass: "pass", part: "partial", fail: "fail", inconclusive: "inconclusive", na: "n/a" } as const;

class Refusal extends Error {}

async function inflate(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === "undefined") throw new Refusal("This browser cannot open share links. Open the report file instead.");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INPUT) { await reader.cancel(); throw new Refusal("That link holds more than a Sealmark report can be."); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

export function ReportViewer() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [paste, setPaste] = useState("");
  const gen = useRef(0);

  const show = useCallback((raw: string, source: string) => {
    const r = parseReport(raw);
    setState(r.ok ? { phase: "ready", runs: r.runs, failed: r.failed, source } : { phase: "error", message: r.error });
  }, []);

  const fromHash = useCallback(async () => {
    const bytes = fragmentBytes(window.location.hash);
    if (!bytes) {
      if (/^#r=/.test(window.location.hash)) setState({ phase: "error", message: "That share link is damaged or too large. Ask for a new one, or open the report file." });
      return;
    }
    const mine = ++gen.current;
    setState({ phase: "loading" });
    try {
      const raw = await inflate(bytes);
      if (mine === gen.current) show(raw, "a share link");
    } catch (e) {
      if (mine === gen.current) setState({ phase: "error", message: e instanceof Refusal ? e.message : "That share link is damaged. Ask for a new one, or open the report file." });
    }
  }, [show]);

  useEffect(() => {
    const on = () => { void fromHash(); };
    const first = setTimeout(on, 0); // after mount, so the first read of the address is not a state change inside the effect
    window.addEventListener("hashchange", on);
    const token = gen;
    return () => { clearTimeout(first); window.removeEventListener("hashchange", on); token.current++; };
  }, [fromHash]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_INPUT) { setState({ phase: "error", message: "That file is too large to be a Sealmark report." }); return; }
    const mine = ++gen.current;
    setState({ phase: "loading" });
    try {
      const raw = await f.text();
      if (mine === gen.current) show(raw, f.name.slice(0, 120));
    } catch {
      if (mine === gen.current) setState({ phase: "error", message: "The file could not be read." });
    }
  };

  const message = state.phase === "error" ? state.message : state.phase === "loading" ? "Reading the report." : state.phase === "ready" ? `Showing ${state.runs.length} ${state.runs.length === 1 ? "run" : "runs"} from ${state.source}.` : "";

  return (
    <div data-state={state.phase} aria-busy={state.phase === "loading"}>
      <div className={s.inputs}>
        <label className={s.file}>
          <span>Open a report file</span>
          <input type="file" accept=".json,application/json" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <form className={s.paste} onSubmit={(e) => { e.preventDefault(); if (paste.trim()) show(paste, "pasted text"); }}>
          <label htmlFor="report-paste">Or paste the JSON</label>
          <textarea id="report-paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} spellCheck={false} autoComplete="off" />
          <button type="submit" className={s.btn} disabled={!paste.trim()}>Show report</button>
        </form>
      </div>
      <p role="status" className={state.phase === "error" ? s.err : s.status}>{message}</p>
      {state.phase === "ready" && (
        <div className={s.runs}>
          {state.failed.length > 0 && <p className={s.muted}>Not shown, the run failed: {state.failed.map((f) => f.server).join(", ")}.</p>}
          {state.runs.map((r, i) => <RunView key={i} run={r} />)}
        </div>
      )}
    </div>
  );
}

function RunView({ run }: { run: ViewRun }) {
  return (
    <section className={s.run} aria-label={`Report for ${run.server.name}`}>
      <h2 className={s.h2}>{run.server.name} <small>{run.server.version}</small></h2>
      <p className={s.meta}>
        Sealmark {run.sealmark.version || "unknown"}{run.sealmark.methodology ? `, methodology ${run.sealmark.methodology}` : ""}
        {run.standard === true ? " · standard configuration" : run.standard === false ? " · custom configuration: not comparable to the public grades" : ""}
        {run.coverage ? ` · coverage ${run.coverage}` : ""}{run.startedAt ? ` · ${run.startedAt}` : ""}
      </p>
      <p className={s.honest}>This is a report you opened, not a result Sealmark published. Sealmark has not checked it was produced by the CLI unchanged.</p>
      <ul className={s.packs}>
        {run.packs.map((p) => (
          <li key={p.id}>
            {p.letter ? <Seal g={p.letter} prov={p.provisional} /> : <span className={s.dash} role="img" aria-label="Not graded">–</span>}
            <b>{p.id}</b>
            <small>{p.letter ? `${p.pct ?? "?"}%${p.capped ? ", capped" : ""}` : p.status === "na" ? "not applicable" : "not graded"}{p.reason ? `: ${p.reason}` : ""}</small>
          </li>
        ))}
      </ul>
      <h3 className={s.h3}>Checks</h3>
      <ul className={s.checks}>
        {run.checks.map((c, i) => (
          <li key={`${c.id}-${i}`} data-verdict={c.verdict}>
            <details>
              <summary>
                <span className={s.verdict}>{WORD[c.verdict]}</span>
                <span>{c.label}</span>
                {c.advisory && <small> advisory, not scored</small>}
              </summary>
              <p>{c.summary}</p>
              {c.scope && <p className={s.muted}>Scope: {c.scope}</p>}
              {c.evidence.length > 0 && (
                <ol className={s.ev}>
                  {c.evidence.map((e, j) => (
                    <li key={j}><code>{e.probe}</code> → <code>{e.outcome}</code> <small>{[e.verifiedBy, e.tool].filter(Boolean).join(" · ")}</small></li>
                  ))}
                </ol>
              )}
              {c.evidenceCut > 0 && <p className={s.muted}>{c.evidenceCut} more evidence lines are in the file.</p>}
            </details>
          </li>
        ))}
      </ul>
      {run.checksCut > 0 && <p className={s.muted}>{run.checksCut} more checks are in the file.</p>}
      {run.notCovered.length > 0 && (<><h3 className={s.h3}>Not covered</h3><ul className={s.plain}>{run.notCovered.map((n, i) => <li key={i}>{n}</li>)}</ul></>)}
      {run.warnings.length > 0 && (<><h3 className={s.h3}>Warnings</h3><ul className={s.plain}>{run.warnings.map((n, i) => <li key={i}>{n}</li>)}</ul></>)}
    </section>
  );
}
