import Link from "next/link";
import { Logo } from "./Logo";
import { AUTHOR, CONTACT } from "@/lib/site";

const Byline = () => (
  <>Created by <a href={AUTHOR.url} rel="author noopener" target="_blank">{AUTHOR.name}</a></>
);

// Home: the full footer. Docs: the slim one-row footer, styled by the docs shell (it passes its own classes);
// the byline and the "not an endorsement" line are the shared parts.
export function Footer({ docs }: { docs?: { root: string; inner: string } }) {
  if (docs) {
    return (
      <footer className={docs.root}>
        <div className={docs.inner}>
          <span>Grades are for the tested version and settings. An A is not a security endorsement.</span>
          <span><Byline /></span>
        </div>
      </footer>
    );
  }
  return (
    <footer className="gutter">
      <div className="frame">
        <div className="frow">
          <div className="fbrand">
            <a className="brand" href="#top" style={{ fontSize: "1.15rem" }}><Logo size={24} />Sealmark</a>
            <p>Behavioral conformance tests for MCP servers.</p>
            <p className="byline"><Byline /></p>
          </div>
          <nav className="flinks" aria-label="Footer">
            <Link href="/docs/">Docs</Link>
            <Link href="/results/">Graded servers</Link>
            <Link href="/mcp-conformance-testing/">MCP conformance testing</Link>
            <Link href="/compare/">Compare tools</Link>
            <Link href="/docs/methodology/">Methodology</Link>
            <Link href="/docs/disclosure/">Disclosure</Link>
            <Link href="/docs/changelog/">Changelog</Link>
            <a href="https://github.com/jordanallenlewis/sealmark" rel="noopener">GitHub</a>
            <a href={`mailto:${CONTACT.email}`}>Contact</a>
          </nav>
        </div>
        <div className="legal"><span>Grades are for the tested version and settings; maintainers can ask for a correction at any time. An A is not a security endorsement. Not affiliated with any MCP server project.</span><span>Security reports: <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a></span></div>
      </div>
    </footer>
  );
}
