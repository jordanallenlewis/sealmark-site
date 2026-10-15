import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocHeader, Status } from "@/components/docs/MdxBits";
import { CHECKS, META, Prose, VerifiedChips, keyId } from "../../ref";
import s from "../../ref.module.css";

export const dynamicParams = false;

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return CHECKS.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = CHECKS.find((x) => x.id === id);
  return c ? { title: `${c.id} | Sealmark checks`, description: c.label } : {};
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export default async function CheckPage({ params }: Props) {
  const { id } = await params;
  const i = CHECKS.findIndex((x) => x.id === id);
  if (i < 0) notFound();
  const c = CHECKS[i];
  const prev = CHECKS[i - 1];
  const next = CHECKS[i + 1];
  const thresholds = Object.entries(c.thresholds);
  const hasCore = c.probes.some((p) => p.core);
  // enabled and severity exist for every check: stated once above the tables and listed once on the configuration page.
  const settings = c.settings.filter((k) => !/\.(enabled|severity)$/.test(k.path));

  return (
    <article>
      <DocHeader title={c.id} description={c.label} status={c.status} />
      <p className={s.note}>The sections below are generated from the CLI (methodology {META.methodology}, CLI {META.cliVersion}); the same text is printed by <code className={s.code}>sealmark explain {c.id}</code>.</p>

      <div className={s.card}>
        <dl className={s.facts}>
          <dt>suite</dt>
          <dd>
            <code>{c.pack}</code>
            {c.inStandardPacks ? null : <> <span className="chip c-inconclusive">opt-in suite</span></>}
          </dd>
          <dt>weight</dt>
          <dd>
            <span className={s.chips}>
              {c.critical ? <Status kind="critical">critical</Status> : null}
              {c.advisory ? <Status kind="advisory">advisory · not scored</Status> : null}
              {!c.critical && !c.advisory ? <span className="chip c-na">scored</span> : null}
              {c.candidate ? <span className="chip c-inconclusive" title="Reported with its verdict, but not scored until a methodology bump promotes it">candidate</span> : null}
            </span>
          </dd>
          <dt>scope</dt>
          <dd>{c.scope}</dd>
          <dt>decided by</dt>
          <dd><span className={s.chips}><VerifiedChips list={c.verifiedBy} /></span></dd>
          <dt>since</dt>
          <dd>{c.since} (methodology {META.methodology})</dd>
          {c.replaces && c.replaces.length ? (
            <>
              <dt>replaces</dt>
              <dd><span className={s.chips}>{c.replaces.map((r) => <code key={r} className={s.code}>{r}</code>)}</span> (retired id)</dd>
            </>
          ) : null}
          {c.configKeys.length ? (
            <>
              <dt>config keys</dt>
              <dd>
                <span className={s.chips}>
                  {c.configKeys.map((k) => (
                    <Link key={k} href={`/docs/reference/configuration#${keyId(k)}`}><code className={s.code}>{k}</code></Link>
                  ))}
                </span>
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <h2 className={s.h2} id="probes">Probes</h2>
      {c.probes.length ? (
        <>
          <ul className={s.list}>
            {c.probes.map((p) => (
              <li key={p.id}>
                <code className={s.code}>{p.id}</code> {p.text}
                {p.core ? <> <span className="chip c-na" title="a canonical probe of the check">core</span></> : null}
              </li>
            ))}
          </ul>
          {hasCore ? <p className={s.note}><strong>core</strong> marks the canonical probes of the check; the others are extra coverage. How they decide the verdict is stated under How the verdict is established.</p> : null}
        </>
      ) : (
        <p className={s.note}>
          {c.status === "planned" ? "This check makes no probe in methodology " + META.methodology + ": it is listed, reported as not measured, and never scored." : "This build does not list a probe corpus for this check; the notes below and the methodology page describe it."}
        </p>
      )}

      <h2 className={s.h2} id="settings">Settings and thresholds</h2>
      <p className={s.note}>Every check also takes <code className={s.code}>checks.{c.id}.enabled</code> and <code className={s.code}>checks.{c.id}.severity</code>; they are described once in the <Link href="/docs/reference/configuration#key-checks-id">configuration reference</Link>.</p>
      {thresholds.length ? (
        <div className="tw">
          <table className={`${s.tbl} ${s.stack}`}>
            <thead>
              <tr>
                <th scope="col">Threshold</th>
                <th scope="col">Default</th>
                <th scope="col">Set with</th>
                <th scope="col">Standard</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.map(([name, t]) => (
                <tr key={name}>
                  <th scope="row"><code>{name}</code></th>
                  <td data-label="Default"><code>{show(t.default)}</code></td>
                  <td data-label="Set with">
                    {t.configKey.startsWith("(") ? <span className={s.muted}>{t.configKey}</span> : <Link href={`/docs/reference/configuration#${keyId(t.configKey)}`}><code className={s.code}>{t.configKey}</code></Link>}
                  </td>
                  <td data-label="Standard">{t.standardLocked ? "locked" : "not locked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={s.note}>This check has no numeric threshold.</p>
      )}
      {settings.length ? (
        <div className="tw">
          <table className={`${s.tbl} ${s.stack}`}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Default</th>
                <th scope="col">Standard</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((k) => (
                <tr key={k.path}>
                  <th scope="row"><Link href={`/docs/reference/configuration#${keyId(k.path)}`}><code className={s.code}>{k.path}</code></Link></th>
                  <td data-label="Default">{k.default === null || k.default === undefined ? <span className={s.muted}>none</span> : <code>{show(k.default)}</code>}</td>
                  <td data-label="Standard">{k.standardLocked ? "locked" : "not locked"}</td>
                  <td data-label="Meaning">{k.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2 className={s.h2} id="how-the-verdict-is-established">How the verdict is established</h2>
      <ul className={s.list}>
        <li><strong>Scoring.</strong> {c.scoring}</li>
      </ul>

      <h2 className={s.h2} id="what-to-fix">What to fix</h2>
      {c.remediation ? <p>{c.remediation}</p> : <p className={s.note}>Nothing to fix: this check has no remediation text because it is not measured or not yet scored.</p>}

      <h2 className={s.h2} id="false-positives">False positives</h2>
      <p>{c.falsePositive || "None known."}</p>

      <h2 className={s.h2} id="false-negatives">False negatives</h2>
      <p>{c.falseNegative || "None known."}</p>

      <div className={s.prose}>
        <Prose file={`reference/checks/${c.id}`} heading="Notes" />
      </div>

      <nav className={s.pager} aria-label="Other checks">
        {prev ? <Link href={`/docs/reference/checks/${prev.id}`} rel="prev"><small>previous</small>{prev.id}</Link> : <span />}
        {next ? <Link href={`/docs/reference/checks/${next.id}`} rel="next"><small>next</small>{next.id}</Link> : <span />}
      </nav>
    </article>
  );
}
