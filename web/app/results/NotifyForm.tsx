"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import s from "./results.module.css";

// "Email me when this grade changes" on a server's results page. Posts to the notify Worker (worker/index.js), which
// answers the same way whatever the address, then sends a confirm link (double opt-in). One status per flow on the
// root as data-state: idle · sending · sent · error.
type State = { phase: "idle" } | { phase: "sending" } | { phase: "sent"; message: string } | { phase: "error"; message: string };

export function NotifyForm({ server, name }: { server: string; name: string }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!email) return setState({ phase: "error", message: "Enter an email address." });
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setState({ phase: "sending" });
    try {
      const res = await fetch("/api/notify/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ server, email }),
        signal: ctrl.current.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) setState({ phase: "sent", message: body.message ?? "Check your inbox for a confirmation link." });
      else setState({ phase: "error", message: body.message ?? "That did not work. Try again later." });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setState({ phase: "error", message: "No connection. Try again." });
    }
  }

  const busy = state.phase === "sending";
  return (
    <section className={`${s.sec} ${s.notify}`} data-state={state.phase} aria-labelledby="notify-h" aria-busy={busy}>
      <h2 id="notify-h">Grade alerts</h2>
      <p>One email when the grade of {name} changes after a re-test. Nothing else, and every email has a link to stop them.</p>
      {state.phase !== "sent" && (
        <form className={s.notifyRow} onSubmit={onSubmit} noValidate>
          <label htmlFor="notify-email" className="sr-only">Email address</label>
          <input id="notify-email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" className={s.notifyInput} disabled={busy} />
          <button type="submit" className="btn" disabled={busy}>{busy ? "Sending..." : "Email me when this grade changes"}</button>
        </form>
      )}
      <p role="status" className={state.phase === "error" ? s.notifyErr : s.muted}>
        {state.phase === "sent" || state.phase === "error" ? state.message : ""}
      </p>
      <p className={s.muted}><Link href="/notify/">What is stored and how to stop the emails</Link></p>
    </section>
  );
}
