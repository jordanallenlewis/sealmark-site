"use client";
import { clsx } from "clsx";
// Hand-rolled docs search over /docs-index.json (built by scripts/docs-index.mjs). Work package D1.
//   - the index is fetched once, on first focus
//   - words are split on anything that is not a letter or digit, so "T2-SECRET" is "t2" + "secret" and "--fail-under" is "fail" + "under"
//   - every query word must match; a word of 3+ characters matches by prefix, shorter ones exactly
//   - score per word: title 5, heading 3, body 1; whole-phrase bonus; top 8, at most 3 per page
//   - "/" focuses the bar, arrows move, Enter opens, Esc closes
//   - load state is one value on the root as data-state: idle | loading | ready | error (aria-busy while loading).
//     An error is not terminal: focusing the bar again or pressing Retry fetches the index again.
//   - the role=status live region sits outside the hidden results panel, so hit counts and errors are announced
import { SkeletonBox } from "skullet/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import s from "@/app/docs/docs.module.css";

interface Entry {
  url: string;
  title: string;
  group: string;
  section: string;
  headings: string[];
  text: string;
  status?: string;
}
interface Prepared extends Entry {
  t: string[];
  h: string[];
  b: string[];
}
interface Hit {
  e: Prepared;
  score: number;
  words: string[];
}

const split = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const hasWord = (list: string[], q: string) => (q.length >= 3 ? list.some((w) => w.startsWith(q)) : list.includes(q));

function prepare(entries: Entry[]): Prepared[] {
  return entries.map((e) => ({ ...e, t: split(e.title), h: split(`${e.section} ${e.headings.join(" ")}`), b: split(e.text) }));
}

function run(index: Prepared[], query: string): Hit[] {
  const words = split(query);
  if (!words.length) return [];
  const phrase = query.trim().toLowerCase();
  const hits: Hit[] = [];
  for (const e of index) {
    let score = 0;
    let ok = true;
    for (const q of words) {
      const w = hasWord(e.t, q) ? 5 : hasWord(e.h, q) ? 3 : hasWord(e.b, q) ? 1 : 0;
      if (!w) {
        ok = false;
        break;
      }
      score += w;
    }
    if (!ok) continue;
    if (phrase.length > 2 && (e.text.toLowerCase().includes(phrase) || e.section.toLowerCase().includes(phrase))) score += 2;
    hits.push({ e, score, words });
  }
  hits.sort((a, b) => b.score - a.score);
  const perPage = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of hits) {
    const page = h.e.url.split("#")[0];
    const n = perPage.get(page) ?? 0;
    if (n >= 3) continue;
    perPage.set(page, n + 1);
    out.push(h);
    if (out.length === 8) break;
  }
  return out;
}

/** A short piece of the body around the first match, with the match marked. */
function Snippet({ hit }: { hit: Hit }) {
  const { text } = hit.e;
  const low = text.toLowerCase();
  let at = -1;
  let len = 0;
  for (const q of hit.words) {
    const i = low.indexOf(q);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = q.length;
    }
  }
  if (at < 0) return <>{text.slice(0, 110)}{text.length > 110 ? "…" : ""}</>;
  const from = Math.max(0, at - 36);
  const to = Math.min(text.length, at + len + 80);
  return (
    <>
      {from > 0 ? "…" : ""}
      {text.slice(from, at)}
      <mark>{text.slice(at, at + len)}</mark>
      {text.slice(at + len, to)}
      {to < text.length ? "…" : ""}
    </>
  );
}

type Load = "idle" | "loading" | "ready" | "error";

export function Search({ variant = "bar", hotkey = false }: { variant?: "bar" | "page"; hotkey?: boolean }) {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const [load, setLoad] = useState<Load>("idle");
  const [index, setIndex] = useState<Prepared[]>([]);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  // retry = true also refetches after an error (focus and the Retry button); typing only starts the first load.
  function ensureIndex(retry = false) {
    if (load === "loading" || load === "ready" || (load === "error" && !retry)) return;
    setLoad("loading");
    const ctl = new AbortController();
    abort.current = ctl;
    fetch("/docs-index.json", { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Entry[]>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setIndex(prepare(d));
        setLoad("ready");
      })
      .catch(() => {
        if (!ctl.signal.aborted) setLoad("error");
      });
  }

  const hits = useMemo(() => (load === "ready" ? run(index, q) : []), [index, load, q]);
  const shown = open && q.trim().length > 0;
  const active = Math.min(cur, Math.max(hits.length - 1, 0));
  const opt = (i: number) => `${id}-o${i}`;

  function go(h: Hit) {
    setOpen(false);
    setQ("");
    input.current?.blur();
    router.push(h.e.url);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      setOpen(true);
      setCur((active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      if (shown && hits[active]) {
        e.preventDefault();
        go(hits[active]);
      }
    } else if (e.key === "Escape") {
      if (shown) setOpen(false);
      else if (q) setQ("");
      else input.current?.blur();
    }
  }

  const message =
    load === "error" ? "Search is not available right now." : load === "loading" ? "Loading the index…" : load === "ready" && !hits.length ? `No results for “${q.trim()}”.` : "";
  // What a screen reader hears: the message, or the hit count. Empty while the panel is closed.
  const announce = !shown ? "" : message || `${hits.length} ${hits.length === 1 ? "result" : "results"}.`;

  return (
    <div className={clsx(s.search, variant === "page" && s.searchPage)} role="search" data-state={load} aria-busy={load === "loading" || undefined} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <input
        ref={input}
        className={s.searchInput}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Search the docs"
        aria-label="Search the docs"
        role="combobox"
        aria-expanded={shown && hits.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && hits.length ? opt(active) : undefined}
        value={q}
        onFocus={() => {
          ensureIndex(true);
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setCur(0);
          setOpen(true);
          ensureIndex();
        }}
        onKeyDown={onKeyDown}
      />
      {hotkey ? <kbd className={s.searchKey} aria-hidden="true">/</kbd> : null}
      <div className={s.results} hidden={!shown} onMouseDown={(e) => e.preventDefault()}>
        <ul id={`${id}-list`} role="listbox" aria-label="Search results" hidden={!hits.length}>
          {hits.map((h, i) => (
            <li key={h.e.url} id={opt(i)} role="option" aria-selected={i === active} className={i === active ? s.on : undefined}>
              <Link href={h.e.url} prefetch={false} tabIndex={-1} onClick={() => { setOpen(false); setQ(""); }}>
                <span className={s.resTitle}>
                  {h.e.title}
                  {h.e.section ? <span className={s.resSection}> › {h.e.section}</span> : null}
                  {h.e.status && h.e.status !== "shipped" ? <span className={s.resTag}>{h.e.status}</span> : null}
                </span>
                <span className={s.resGroup}>{h.e.group}</span>
                <span className={s.resSnip}><Snippet hit={h} /></span>
              </Link>
            </li>
          ))}
        </ul>
        {load === "loading" ? (
          <div className={s.resSkel} aria-hidden="true">
            {[0, 1, 2].map((n) => (
              <div key={n} className={s.resSkelRow}>
                <SkeletonBox height="0.9rem" width={n === 1 ? "55%" : "70%"} radius="0.3em" />
                <SkeletonBox height="0.7rem" width="90%" radius="0.3em" />
              </div>
            ))}
          </div>
        ) : null}
        {message ? (
          <p className={s.resMsg}>
            {message}
            {load === "error" ? (
              <>
                {" "}
                <button type="button" className={s.resRetry} onClick={() => ensureIndex(true)}>Retry</button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <p className="sr-only" role="status">{announce}</p>
    </div>
  );
}
