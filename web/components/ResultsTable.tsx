"use client";
import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, RANK, coverageWord, deepPacks, ecosystemLabel, gradedPacks, worst, type Letter, type ServerResult } from "@/lib/results-shared";
import { retestShort } from "@/lib/retest.mjs";
import s from "@/app/results/results.module.css";

type Filter = "all" | "failing" | "clean" | "hygiene";
type Sort = "best" | "worst" | "name";
const FILTERS: [Filter, string][] = [["all", "All"], ["failing", "Has a failing suite"], ["clean", "No failing suite"], ["hygiene", "Protocol only"]];
const SORTS: Sort[] = ["best", "worst", "name"];
const PAGE_SIZE = 25;

// The results table with search, a filter and sort. Rows are plain links, so it works without the interactions too.
// Search, filter and sort live in the query string (?q=&filter=&sort=, defaults omitted): read once after hydration,
// written with replaceState (the page too, as ?page=, 25 servers a page, omitted on page 1), so a filtered view can be shared and survives a reload without a history entry per key.
export function ResultsTable({ servers }: { servers: ServerResult[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("best");
  const [page, setPage] = useState(1);
  const synced = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get("filter") as Filter | null;
    const o = p.get("sort") as Sort | null;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration (static export: no server query) */
    if (p.get("q")) setQ(p.get("q") ?? "");
    if (f && FILTERS.some(([k]) => k === f)) setFilter(f);
    if (o && SORTS.includes(o)) setSort(o);
    const n = Number(p.get("page"));
    if (Number.isInteger(n) && n > 1) setPage(n);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!synced.current) {
      synced.current = true; // the first run is the hydration render; the read above has not applied yet
      return;
    }
    const url = new URL(window.location.href);
    const set = (k: string, v: string, def: string) => (v && v !== def ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set("q", q.trim(), "");
    set("filter", filter, "all");
    set("sort", sort, "best");
    set("page", String(page), "1");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  }, [q, filter, sort, page]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = servers.filter((x) => {
      if (term && !x.name.toLowerCase().includes(term)) return false;
      const w = worst(x);
      const deep = deepPacks(x);
      if (filter === "failing") return deep.some((p) => p.letter === "D" || p.letter === "F");
      if (filter === "clean") return deep.length > 0 && deep.every((p) => p.letter !== "D" && p.letter !== "F");
      if (filter === "hygiene") return deep.length === 0 && Boolean(w);
      return true;
    });
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const wa = worst(a), wb = worst(b);
      const g = (wb ? RANK[wb.letter] : -1) - (wa ? RANK[wa.letter] : -1);
      // flip only the grade order; ties always go by name, A to Z
      return (sort === "best" ? g : -g) || a.name.localeCompare(b.name);
    });
    return list;
  }, [servers, q, filter, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages); // a stale ?page= past the end, or a narrower filter, lands on the last page
  const shown = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  // Search, filter and sort start again at page 1; the pager changes the page and scrolls back to the table top.
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const goPage = (n: number) => { setPage(n); top.current?.scrollIntoView({ block: "start" }); };

  return (
    <>
      <div className={s.tools}>
        <input className={s.search} type="search" placeholder="Search servers" aria-label="Search servers" value={q} onChange={(e) => change(setQ)(e.target.value)} />
        <div className={s.pills} role="group" aria-label="Filter">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={clsx(s.pill, filter === k && s.on)} aria-pressed={filter === k} onClick={() => change(setFilter)(k)}>{label}</button>
          ))}
        </div>
        <label className={s.sort}>Sort
          <select value={sort} onChange={(e) => change(setSort)(e.target.value as Sort)}>
            <option value="best">Best grade first</option>
            <option value="worst">Worst grade first</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div ref={top} className={clsx(s.tw, s.twCards)} style={{ scrollMarginTop: 80 }}>
        <table className={s.table}>
          <caption className="sr-only">Servers tested, with the server grade (its lowest test-area grade), the protocol grade and the deeper suite grades</caption>
          <thead>
            <tr><th scope="col">Server</th><th scope="col">Version</th><th scope="col">Grade</th><th scope="col">Protocol</th><th scope="col">Deeper suites</th><th scope="col">Coverage</th></tr>
          </thead>
          <tbody>
            {shown.map((x) => {
              const core = gradedPacks(x).find((p) => p.id === "core");
              const deep = deepPacks(x);
              const w = x.toolCount === 0 && (!x.coverage || x.coverage.toolsTotal === 0) ? null : worst(x);
              return (
                <tr key={x.id}>
                  <td className={s.srv}><Link href={`/results/${x.id}/`}>{x.name}</Link><small>{ecosystemLabel(x)}</small>{retestShort(x) && <small>{retestShort(x)}</small>}</td>
                  <td className={s.muted} data-label="Version">{x.versionTested}</td>
                  <td className={s.gradeCell} data-label="Grade">{w ? <Seal g={w.letter as Letter} prov={w.provisional} /> : <span className={s.muted}>no grade</span>}</td>
                  <td data-label="Protocol">{core?.letter ? <Seal g={core.letter} prov={core.provisional} /> : <span className={s.muted}>n/a</span>}</td>
                  <td data-label="Deeper suites">
                    {deep.length ? (
                      <div className={s.packs}>
                        {deep.map((p) => <span key={p.id} className={s.pk}><Seal g={p.letter as Letter} prov={p.provisional} /> {PACK_LABEL[p.id] ?? p.id}</span>)}
                      </div>
                    ) : <span className={s.muted}>none applied</span>}
                  </td>
                  <td className={s.muted} data-label="Coverage">{coverageWord(x)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className={s.muted}>No server matches. Clear the search or the filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={cur} pages={pages} onPage={goPage} />
      <p className={s.muted} style={{ marginTop: 10 }} aria-live="polite">{rows.length ? `${(cur - 1) * PAGE_SIZE + 1}-${(cur - 1) * PAGE_SIZE + shown.length} of ${rows.length}` : "0"} servers{rows.length !== servers.length ? ` (${servers.length} tested in all)` : ""}. A * means a critical check could not be judged, so the grade is provisional.</p>
    </>
  );
}
