// 404 page (work package D1). Next writes it to out/404.html, which wrangler.jsonc serves for unknown paths.
// It renders inside the root layout only, so it brings its own header. Links are absolute because the
// page can be served at any depth. It must not import the docs shell stylesheet or the docs Search: this file is in the
// root layout's graph, so both would ship on every route (that cost the home page 56 KB of CSS and a 15 KB chunk).
import type { Metadata } from "next";
import Link from "next/link";
import type { NavGroup } from "@/components/docs/nav";
import { Logo } from "@/components/Logo";
import navJson from "@/content/docs/_nav.json";
import s from "./not-found.module.css";

export const metadata: Metadata = { title: "Page not found | Sealmark" };

const NAV = navJson as NavGroup[];

export default function NotFound() {
  return (
    <div className={s.root}>
      <header className="masthead">
        <div className={`gutter ${s.headInner}`}>
          <Link className="brand" href="/" aria-label="Sealmark home">
            <Logo />
            <span className={s.brandText}>Sealmark</span>
          </Link>
          <nav aria-label="Site" className={s.siteNav}>
            <Link href="/">Home</Link>
            <Link href="/results/">Results</Link>
            <Link href="/docs/">Docs</Link>
          </nav>
        </div>
      </header>
      <main className={s.nf} id="top">
        <p className={s.nfKick}>404</p>
        <h1>That page is not here.</h1>
        <p>The link may be old, or the page may not exist yet. Pick a page below, or <Link href="/docs/">start at the docs home</Link>, where the search box is.</p>
        <nav className={s.nfLinks} aria-label="Docs pages">
          {NAV.map((g) => (
            <div key={g.group}>
              <h2>{g.group}</h2>
              <ul>
                {g.items.map((i) => (
                  <li key={i.url}>
                    <Link href={i.url} prefetch={false}>{i.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </main>
    </div>
  );
}
