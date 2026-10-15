"use client";
// <nav aria-label="Docs"> built from content/docs/_nav.json (work package D1).
// Groups are <details open>; the group of the current page is forced open after every navigation.
// The current page gets aria-current="page" and the gold left bar; pages below it (a single check below "Checks") get a quieter mark.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import s from "@/app/docs/docs.module.css";
import { Status } from "./Status";
import { normalizePath, type NavGroup } from "./nav";

export function Sidebar({ nav }: { nav: NavGroup[] }) {
  const path = normalizePath(usePathname() || "/");
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    root.current?.querySelector<HTMLDetailsElement>("details[data-current]")?.setAttribute("open", "");
  }, [path]);

  return (
    <nav className={s.sidebar} aria-label="Docs" ref={root}>
      {nav.map((g) => {
        const here = g.items.some((i) => path === normalizePath(i.url) || path.startsWith(normalizePath(i.url) + "/"));
        return (
          <details key={g.group} className={s.group} open data-current={here ? "" : undefined}>
            <summary>{g.group}</summary>
            <ul>
              {g.items.map((i) => {
                const url = normalizePath(i.url);
                const exact = path === url;
                const trail = !exact && url !== "/docs" && path.startsWith(url + "/");
                return (
                  <li key={i.url}>
                    <Link href={i.url} prefetch={false} aria-current={exact ? "page" : undefined} data-trail={trail ? "" : undefined} className={s.navLink}>
                      <span>{i.title}</span>
                      {i.status !== "shipped" ? <Status kind={i.status}>{i.status}</Status> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </nav>
  );
}
