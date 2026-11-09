"use client";
import { clsx } from "clsx";
// Previous / next cards from the _nav.json order (work package D1).
// A page that is not listed (one check below "Checks") gets an "Up" card to the listed page that contains it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "@/app/docs/docs.module.css";
import { flatten, normalizePath, parentOf, type FlatItem, type NavGroup } from "./nav";

function Card({ item, kind }: { item: FlatItem; kind: "prev" | "next" | "up" }) {
  const label = kind === "prev" ? "← Previous" : kind === "next" ? "Next →" : "↑ Up";
  return (
    <Link href={item.url} prefetch={false} rel={kind === "up" ? undefined : kind} className={clsx(s.pnCard, kind === "next" && s.pnNext)}>
      <small>{label}</small>
      <span>{item.title}</span>
      <em>{item.group}</em>
    </Link>
  );
}

export function PrevNext({ nav }: { nav: NavGroup[] }) {
  const path = normalizePath(usePathname() || "/");
  const flat = flatten(nav);
  const i = flat.findIndex((x) => normalizePath(x.url) === path);
  let prev: FlatItem | undefined;
  let next: FlatItem | undefined;
  let up: FlatItem | undefined;
  if (i >= 0) {
    prev = flat[i - 1];
    next = flat[i + 1];
  } else {
    up = parentOf(path, flat);
  }
  if (!prev && !next && !up) return null;
  return (
    <nav className={s.pn} aria-label="Previous and next pages">
      {prev ? <Card item={prev} kind="prev" /> : up ? <Card item={up} kind="up" /> : <span />}
      {next ? <Card item={next} kind="next" /> : <span />}
    </nav>
  );
}
