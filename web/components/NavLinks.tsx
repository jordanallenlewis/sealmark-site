"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The masthead links. In-page anchors (/#how) carry `anc`, which phones hide so Docs and the Quickstart button always fit;
// Results (`wide`) stays at every width. The current section gets aria-current="page", underlined in gold.
export function NavLinks({ links }: { links: [href: string, label: string][] }) {
  const path = usePathname() ?? "/";
  return (
    <nav className="navlinks" aria-label="Site">
      {links.map(([h, l]) => {
        const anchor = h.includes("#");
        const current = !anchor && h !== "/" && path.startsWith(h.replace(/\/$/, ""));
        return <Link key={h} href={h} className={anchor ? "anc" : h === "/results/" ? "wide" : undefined} aria-current={current ? "page" : undefined}>{l}</Link>;
      })}
    </nav>
  );
}
