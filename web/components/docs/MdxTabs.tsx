"use client";
// Fallback Tabs/Tab owned by work package D2. Usage in MDX:
//   <Tabs items={["CLI", "YAML"]}><Tab>...</Tab><Tab>...</Tab></Tabs>
// Arrow keys, Home and End move between tabs. The first panel is the server-rendered default.
import { Children, isValidElement, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import s from "./MdxBits.module.css";

export function Tab({ children }: { title?: string; children: ReactNode }) {
  return <div>{children}</div>;
}

export function Tabs({ items, children }: { items?: string[]; children: ReactNode }) {
  const panels = Children.toArray(children).filter(isValidElement);
  const titles = panels.map((p, i) => items?.[i] ?? (p.props as { title?: string }).title ?? `Tab ${i + 1}`);
  const [active, setActive] = useState(0);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = titles.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={s.tabs}>
      <div className="ctabs" role="tablist" aria-label="Variants">
        {titles.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-p${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div key={titles[i]} className={s.panel} role="tabpanel" id={`${id}-p${i}`} aria-labelledby={`${id}-t${i}`} hidden={active !== i}>
          {p}
        </div>
      ))}
    </div>
  );
}
