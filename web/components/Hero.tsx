"use client";
import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { Mechanism } from "./visuals/Mechanism";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

const CLI_TEXT = "npx sealmark init\nnpx sealmark run";

const rise = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function Hero() {
  const [tab, setTab] = useState<"cli" | "agent">("cli");

  return (
    <section className="hero gutter" aria-label="Introduction">
      <div className="frame hero-grid">
        <div className="hero-copy">
          <h1 className="rise" style={rise(1)}>See what your MCP server <em>actually does.</em></h1>
          <p className="lede rise" style={rise(2)}>Fixed probes call its tools, read the database behind it instead of trusting the answer, and grade the result A–F with the evidence attached.</p>
          <div className="install rise" style={rise(3)}>
            <div className="itabs" role="tablist" aria-label="Install with">
              <button type="button" role="tab" aria-selected={tab === "cli"} onClick={() => setTab("cli")}>cli</button><span aria-hidden="true">/</span>
              <button type="button" role="tab" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>agent</button>
            </div>
            <div className="ibox">
              {tab === "cli" ? (
                <pre role="tabpanel"><span className="pr">$ </span>npx sealmark init{"\n"}<span className="pr">$ </span>npx sealmark run</pre>
              ) : (
                <pre className="wrap" role="tabpanel">{AGENT_PROMPT}</pre>
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
