import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

// One home-page band: H2, one caption line, the figure, at most one quiet docs link.
export function Section({ id, title, caption, more, children }: {
  id: string;
  title: ReactNode;
  caption?: ReactNode;
  more?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="band gutter" id={id}>
      <div className="frame">
        <Reveal className="sechead">
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </Reveal>
        <Reveal className="figgap" delay={60}>{children}</Reveal>
        {more && (
          <Reveal className="morewrap" delay={100}>
            <Link className="more" href={more.href}>{more.label} <span aria-hidden="true">→</span></Link>
          </Reveal>
        )}
      </div>
    </section>
  );
}
