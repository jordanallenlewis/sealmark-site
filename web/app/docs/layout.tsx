// Docs shell (work package D1, plan section 7.2): masthead with search, sidebar | content | on this page.
// Server component. The interactive parts (sidebar highlight, TOC, search, drawer, prev/next) are small client islands.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Drawer } from "@/components/docs/Drawer";
import { MethodologyBadge } from "@/components/docs/MethodologyBadge";
import { PrevNext } from "@/components/docs/PrevNext";
import { PrintDetails } from "@/components/docs/PrintDetails";
import { Search } from "@/components/docs/Search";
import { Sidebar } from "@/components/docs/Sidebar";
import { Toc } from "@/components/docs/Toc";
import type { NavGroup } from "@/components/docs/nav";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { MotionPref } from "@/components/Reveal";
import navJson from "@/content/docs/_nav.json";
import { SITE } from "@/lib/site";
import s from "./docs.module.css";

const NAV = navJson as NavGroup[];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={s.root} style={{ "--site-host": JSON.stringify(SITE.host) } as CSSProperties}>
      <MotionPref />
      <PrintDetails />
      <a className="skip" href="#docs-main">Skip to docs content</a>
      <header className="masthead">
        <div className={`gutter ${s.headInner}`}>
          <Link className="brand" href="/" aria-label="Sealmark home">
            <Logo />
            <span className={s.brandText}>Sealmark</span>
          </Link>
          <span className={s.crumb}>docs</span>
          <Search hotkey />
          <MethodologyBadge className={s.headBadge} />
          <Drawer badge={<MethodologyBadge />}>
            <Sidebar nav={NAV} />
          </Drawer>
        </div>
      </header>
      <div className={s.shell}>
        <aside className={s.side} aria-label="Docs navigation">
          <Sidebar nav={NAV} />
        </aside>
        <main id="docs-main" className={s.main}>
          {children}
          <PrevNext nav={NAV} />
        </main>
        <aside className={s.tocCol} aria-label="On this page">
          <Toc />
        </aside>
      </div>
      <Footer docs={{ root: s.foot, inner: s.footInner }} />
    </div>
  );
}
