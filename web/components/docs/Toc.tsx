"use client";
// "On this page": reads h2/h3 from #docs-main after mount (no build plugin) and highlights the current one (work package D1).
// The layout survives client navigations, so a MutationObserver re-reads the headings when the page content changes.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import s from "@/app/docs/docs.module.css";

interface Item {
  id: string;
  text: string;
  level: 2 | 3;
}

const same = (a: Item[], b: Item[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.text === b[i].text);

function readHeadings(): Item[] {
  const main = document.getElementById("docs-main");
  if (!main) return [];
  return [...main.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map((h) => {
    const clone = h.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("a.anchor").forEach((a) => a.remove()); // the "#" link rehype-autolink-headings appends
    return { id: h.id, text: (clone.textContent ?? "").trim(), level: h.tagName === "H2" ? 2 : 3 };
  });
}

export function Toc() {
  const pathname = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState("");

  // 1. keep `items` in step with the headings in the page
  useEffect(() => {
    const main = document.getElementById("docs-main");
    if (!main) return;
    let raf = 0;
    const scan = () => {
      raf = 0;
      const next = readHeadings();
      setItems((prev) => (same(prev, next) ? prev : next));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(scan);
    };
    queue();
    const mo = new MutationObserver(queue);
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pathname]);

  // 2. scrollspy: the first heading inside the band under the masthead, else the last one above it
  useEffect(() => {
    if (!items.length) return;
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const inBand = new Set<string>();
    const pick = () => {
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atEnd && window.scrollY > 0) return setPicked(els[els.length - 1].id);
      const first = els.find((e) => inBand.has(e.id));
      if (first) return setPicked(first.id);
      const above = els.filter((e) => e.getBoundingClientRect().top < 100);
      setPicked(above.length ? above[above.length - 1].id : "");
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-64px 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    window.addEventListener("scroll", pick, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", pick);
    };
  }, [items]);

  if (!items.length) return null;
  const active = items.some((i) => i.id === picked) ? picked : "";
  return (
    <nav className={s.toc} aria-label="On this page">
      <p className={s.tocTitle}>On this page</p>
      <ul>
        {items.map((i) => (
          <li key={i.id} data-level={i.level}>
            <a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined} onClick={() => setPicked(i.id)}>
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
