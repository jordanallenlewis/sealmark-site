"use client";
import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, coverageWord, deepPacks, ecosystemLabel, gradedPacks, worst, type Letter, type ListRow } from "@/lib/results-shared";
import { AREAS, FILTERS, SORT_OPTIONS, SOURCES, facetCounts, readState, viewRows, writeState } from "@/lib/results-view.mjs";
import { retestShort } from "@/lib/retest.mjs";
import { ageShort, isStale } from "@/lib/grade-age.mjs";
import { useToday } from "@/components/GradeAge";
import s from "@/app/results/results.module.css";

const PAGE_SIZE = 25;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-16" as "Nov 16" (UTC day, no locale: the static page and the browser render the same text). */
const short = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}\u00a0${Number(day.slice(8, 10))}`; // no break inside the date

// The results table with search, a filter, source and test-area facets, and sorts. Rows are plain links, so it works without the interactions too.
// The view lives in the query string (?q=&filter=&source=&area=&sort=, defaults omitted; lib/results-view.mjs): read once after hydration,
// written with replaceState (the page too, as ?page=, 25 servers a page, omitted on page 1), so a filtered view can be shared and survives a reload without a history entry per key.
// builtOn: the build day; each row's age switches to the reader's clock after hydration (components/GradeAge.tsx).
export function ResultsTable({ servers, builtOn }: { servers: ListRow[]; builtOn: string }) {
  const today = useToday(builtOn);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [source, setSource] = useState("");
  const [area, setArea] = useState("");
  const [sort, setSort] = useState("best");
  const [page, setPage] = useState(1);
  const synced = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = readState(new URLSearchParams(window.location.search));
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration (static export: no server query) */
    setQ(v.q); setFilter(v.filter); setSource(v.source); setArea(v.area); setSort(v.sort); setPage(v.page);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!synced.current) {
      synced.current = true; // the first run is the hydration render; the read above has not applied yet
      return;
    }
    const url = new URL(window.location.href);
    writeState(url.searchParams, { q, filter, source, area, sort, page });
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  }, [q, filter, source, area, sort, page]);

  const rows = useMemo(() => viewRows(servers, { q, filter, source, area, sort }), [servers, q, filter, source, area, sort]);
  const counts = useMemo(() => facetCounts(servers, { q, filter, source, area, sort }), [servers, q, filter, source, area, sort]);
  // Areas no server was graded in stay out of the menu; the one in the URL stays so the view can be read.
  // "Recent grade change" is offered once a row has one (or the URL asks for it), so the menu never holds a sort that does nothing.
  const sorts = useMemo(() => SORT_OPTIONS.filter(([k]) => k !== "changed" || k === sort || servers.some((x) => x.change)), [servers, sort]);
  const areas = useMemo(() => AREAS.filter((a) => a === area || servers.some((x) => deepPacks(x).some((p) => p.id === a))), [servers, area]);

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
        <div className={s.selects}>
          <label className={s.sort}>Source
            <select value={source} onChange={(e) => change(setSource)(e.target.value)}>
              <option value="">Any</option>
              {SOURCES.map(([k, label]) => <option key={k} value={k}>{label} ({counts.source[k]})</option>)}
            </select>
          </label>
          <label className={s.sort}>Test area
            <select value={area} onChange={(e) => change(setArea)(e.target.value)}>
              <option value="">Any</option>
              {areas.map((k) => <option key={k} value={k}>{PACK_LABEL[k] ?? k} ({counts.area[k]})</option>)}
            </select>
          </label>
          <label className={s.sort}>Sort
            <select value={sort} onChange={(e) => change(setSort)(e.target.value)}>
              {sorts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        </div>
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
                  <td className={s.srv}><Link href={`/results/${x.id}/`}>{x.name}</Link><small>{ecosystemLabel(x)}</small>{retestShort(x) && <small>{retestShort(x)}</small>}{w && x.change && <small data-third-party="">grade was {x.change.from} on {x.change.fromVersion}, until {short(x.change.date)}</small>}</td>
                  <td className={s.muted} data-label="Version">{x.versionTested}{x.testedOn && <small className={s.when} data-state={isStale(x.testedOn, today) ? "stale" : "current"}>graded {short(x.testedOn)}{ageShort(x.testedOn, today) && <>, {ageShort(x.testedOn, today)}</>}</small>}</td>
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
            {rows.length === 0 && <tr><td colSpan={6} className={s.muted}>No server matches. Clear the search or pick another filter, source or test area.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={cur} pages={pages} onPage={goPage} />
      <p className={s.muted} style={{ marginTop: 10 }} aria-live="polite">{rows.length ? `${(cur - 1) * PAGE_SIZE + 1}-${(cur - 1) * PAGE_SIZE + shown.length} of ${rows.length}` : "0"} servers{rows.length !== servers.length ? ` (${servers.length} tested in all)` : ""}. A * means a critical check could not be judged, so the grade is provisional.</p>
    </>
  );
}
