"use client";
// The results page's badge block: pick a style (flat badge, card, shields.io) and a format (Markdown, HTML, reST),
// copy the snippet. Each row is a radio group: the arrow keys, Home and End move and select within it. Flat badge + Markdown is the server-rendered
// default, so the page without JavaScript still shows a working snippet.
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { badgeSnippets } from "@/lib/badge.mjs";
import { CopyButton } from "./CopyButton";
import s from "./BadgeSnippets.module.css";

const STYLES = [["badge", "Flat badge"], ["card", "Card"], ["shields", "shields.io"]] as const;
const FORMATS = [["markdown", "Markdown"], ["html", "HTML"], ["rst", "reST"]] as const;
type Style = (typeof STYLES)[number][0];
type Format = (typeof FORMATS)[number][0];

function Row<K extends string>({ label, items, active, set }: { label: string; items: readonly (readonly [K, string])[]; active: K; set: (k: K) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = items.findIndex(([k]) => k === active);
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = items.length - 1;
    const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (n < 0) return;
    e.preventDefault();
    set(items[n][0]);
    refs.current[n]?.focus();
  }
  return (
    <div className={`itabs ${s.group}`} role="radiogroup" aria-label={label}>
      <span className={s.rowLabel} aria-hidden="true">{label}</span>
      {items.map(([k, t], i) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={at === i}
          tabIndex={at === i ? 0 : -1}
          onClick={() => set(k)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function BadgeSnippets({ id, name }: { id: string; name: string }) {
  const snip = badgeSnippets(id);
  const [style, setStyle] = useState<Style>("badge");
  const [format, setFormat] = useState<Format>("markdown");
  const code = snip[style][format];
  const img = style === "card" ? `/badge/${id}-card.svg` : `/badge/${id}.svg`;
  return (
    <div className={s.wrap}>
      <figure className={s.preview} data-style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG file, shown exactly as a README would */}
        <img src={img} alt={`Sealmark ${style === "card" ? "card" : "badge"} for ${name}`} loading="lazy" decoding="async" />
        <figcaption>{style === "shields" ? "shields.io draws the flat badge from our endpoint file, in your shields style." : style === "card" ? "The card adds the server grade, version and test date." : "The flat badge, one letter per graded test area."}</figcaption>
      </figure>
      <Row label="Style" items={STYLES} active={style} set={setStyle} />
      <Row label="Format" items={FORMATS} active={format} set={setFormat} />
      <div className={`ibox ${s.cmd}`}>
        <pre tabIndex={0} aria-label={`${STYLES.find(([k]) => k === style)?.[1]} snippet, ${FORMATS.find(([k]) => k === format)?.[1]}`}>{code}</pre>
        <CopyButton text={code} />
      </div>
      <p className={s.files}>
        Files: <a href={`/badge/${id}.svg`}>badge SVG</a>, <a href={`/badge/${id}-card.svg`}>card SVG</a>, <a href={`/badge/${id}.json`}>shields endpoint JSON</a>.
      </p>
    </div>
  );
}
