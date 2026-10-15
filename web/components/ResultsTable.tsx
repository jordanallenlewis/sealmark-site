"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, RANK, coverageWord, deepPacks, ecosystemLabel, gradedPacks, worst, type Letter, type ServerResult } from "@/lib/results-shared";
import s from "@/app/results/results.module.css";

type Filter = "all" | "failing" | "clean" | "hygiene";
const FILTERS: [Filter, string][] = [["all", "All"], ["failing", "Has a failing suite"], ["clean", "No failing suite"], ["hygiene", "Protocol only"]];

// The results table with search, a filter and sort. Rows are plain links, so it works without the interactions too.
export function ResultsTable({ servers }: { servers: ServerResult[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"best" | "worst" | "name">("best");

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
      const d = (wb ? RANK[wb.letter] : -1) - (wa ? RANK[wa.letter] : -1) || a.name.localeCompare(b.name);
      return sort === "best" ? d : -d || a.name.localeCompare(b.name);
    });
    return list;
  }, [servers, q, filter, sort]);

  return (
    <>
      <div className={s.tools}>
        <input className={s.search} type="search" placeholder="Search servers" aria-label="Search servers" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className={s.pills} role="group" aria-label="Filter">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={`${s.pill}${filter === k ? " " + s.on : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <label className={s.sort}>Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as "best" | "worst" | "name")}>
            <option value="best">Best grade first</option>
            <option value="worst">Worst grade first</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr><th>Server</th><th>Version</th><th>Protocol</th><th>Deeper suites</th><th>Coverage</th></tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const core = gradedPacks(x).find((p) => p.id === "core");
              const deep = deepPacks(x);
              return (
                <tr key={x.id}>
                  <td className={s.srv}><Link href={`/results/${x.id}/`}>{x.name}</Link><small>{ecosystemLabel(x)}</small></td>
                  <td className={s.muted}>{x.versionTested}</td>
                  <td>{core?.letter ? <Seal g={core.letter} prov={core.provisional} /> : <span className={s.muted}>n/a</span>}</td>
                  <td>
                    {deep.length ? (
                      <div className={s.packs}>
                        {deep.map((p) => <span key={p.id} className={s.pk}><Seal g={p.letter as Letter} prov={p.provisional} /> {PACK_LABEL[p.id] ?? p.id}</span>)}
                      </div>
                    ) : <span className={s.muted}>none applied</span>}
                  </td>
                  <td className={s.muted}>{coverageWord(x)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className={s.muted}>No server matches. Clear the search or the filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={s.muted} style={{ marginTop: 10 }} aria-live="polite">{rows.length} of {servers.length} servers. A * means a critical check could not be judged, so the grade is provisional.</p>
    </>
  );
}
