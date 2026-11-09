"use client";
import { Fragment, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CopyButton } from "./CopyButton";
import { Mechanism } from "./visuals/Mechanism";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

const CLI_TEXT = "npx sealmark init\nnpx sealmark run";

const TABS = ["cli", "agent"] as const;

const rise = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function Hero() {
  const [tab, setTab] = useState<"cli" | "agent">("cli");
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys, Home and End move between the two tabs (the same pattern as docs/Tabs).
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" || e.key === "ArrowLeft" ? 1 - i : e.key === "Home" ? 0 : e.key === "End" ? 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
    refs.current[next]?.focus();
  }

  return (
    <section className="hero gutter" aria-label="Introduction">
      <div className="frame hero-grid">
        <div className="hero-copy">
          <h1 className="rise" style={rise(1)}>See what your MCP server <em>actually does.</em></h1>
          <p className="lede rise" style={rise(2)}>Fixed probes call its tools, read the database behind it instead of trusting the answer, and grade the result A–F with the evidence attached.</p>
          <div className="install rise" style={rise(3)}>
            <div className="itabs" role="tablist" aria-label="Install with">
              {TABS.map((k, i) => (
                <Fragment key={k}>
                  {i > 0 && <span aria-hidden="true">/</span>}
                  <button
                    ref={(el) => { refs.current[i] = el; }}
                    type="button"
                    role="tab"
                    id={`${id}-t-${k}`}
                    aria-selected={tab === k}
                    aria-controls={`${id}-p`}
                    tabIndex={tab === k ? 0 : -1}
                    onClick={() => setTab(k)}
                    onKeyDown={onKey}
                  >{k}</button>
                </Fragment>
              ))}
            </div>
            <div className="ibox">
              {tab === "cli" ? (
                <pre role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t-cli`}><span className="pr">$ </span>npx sealmark init{"\n"}<span className="pr">$ </span>npx sealmark run</pre>
              ) : (
                <pre className="wrap" role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t-agent`}>{AGENT_PROMPT}</pre>
              )}
              <CopyButton text={tab === "cli" ? CLI_TEXT : AGENT_PROMPT} />
            </div>
            <p className="avail">npm package sealmark · Apache-2.0 · runs locally, no account</p>
          </div>
        </div>
        <div className="hero-art rise" style={rise(3)}><Mechanism /></div>
      </div>
    </section>
  );
}
