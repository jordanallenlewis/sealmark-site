import Link from "next/link";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { RESULTS_PUBLIC } from "@/lib/results";

export { Logo };

// The same links on every page, in the same order.
const LINKS: [href: string, label: string][] = [["/#how", "How it works"], ...(RESULTS_PUBLIC ? [["/results/", "Results"] as [string, string]] : []), ["/docs/", "Docs"]];

export function Nav({ home = false }: { home?: boolean }) {
  return (
    <>
    {!home && <a className="skip" href="#main">Skip to content</a>}
    <header className="masthead">
      <div className="frame gutter">
        {home ? (
          <a className="brand" href="#top" aria-label="Sealmark home"><Logo />Sealmark</a>
        ) : (
          <Link className="brand" href="/" aria-label="Sealmark home"><Logo />Sealmark</Link>
        )}
        <NavLinks links={LINKS} />
        <div className="navright">
          <Link className="btn solid" href="/docs/quickstart/">Quickstart</Link>
        </div>
      </div>
    </header>
    </>
  );
}
