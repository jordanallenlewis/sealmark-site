import type { Metadata } from "next";
import { DocHeader } from "@/components/docs/MdxBits";
import configJson from "@/content/generated/config.json";
import profilesJson from "@/content/generated/profiles.json";
import type { ConfigKey, ProfileDescriptor } from "@/lib/generated";
import { CHECKS, Prose, keyId, provenance } from "../ref";
import s from "../ref.module.css";

export const metadata: Metadata = {
  title: "Configuration reference | Sealmark docs",
  description: "Every key in sealmark.yaml, with its type, default, the version that added it, whether the standard methodology locks it, and its meaning. Generated from the CLI.",
};

const KEYS = configJson as unknown as ConfigKey[];
const PROFILES = profilesJson as unknown as ProfileDescriptor[];
const CHECK_IDS = new Set(CHECKS.map((c) => c.id));
const CANDIDATES = CHECKS.filter((c) => c.candidate).map((c) => c.id);

const CHECK_FAMILY = /^checks\.([^.]+)\.(enabled|severity)$/;
const SERVER_COPY = /^servers\.\*\./;

/**
 * The table of keys, with two families folded into one row each: the 2 templated keys every check has
 * (checks.<id>.enabled and .severity, 90 rows) and the copies of server.* under servers.* (7 rows).
 * The generated file keeps every key; only this rendering collapses them.
 */
type Row = { kind: "key"; key: ConfigKey } | { kind: "checks" } | { kind: "servers" };
function rows(): Row[] {
  const out: Row[] = [];
  let checks = false;
  let servers = false;
  for (const key of KEYS) {
    const m = CHECK_FAMILY.exec(key.path);
    if (m && CHECK_IDS.has(m[1])) {
      if (!checks) out.push({ kind: "checks" });
      checks = true;
    } else if (SERVER_COPY.test(key.path)) {
      if (!servers) out.push({ kind: "servers" });
      servers = true;
    } else out.push({ kind: "key", key });
  }
  return out;
}
const ROWS = rows();

export default function ConfigurationPage() {
  return (
    <article>
      <DocHeader title="Configuration" description="Every key sealmark.yaml accepts today." status="shipped" />
      <p className={s.note}>
        {provenance("its config")} Planned keys are not listed here. <strong>Locked</strong> keys are part of the standard methodology: changing one makes the run CUSTOM. Deprecated keys are still read, with a warning, and are shown muted.
      </p>

      <h2 className={s.h2} id="keys">Keys</h2>
      <div className="tw">
        <table className={`${s.tbl} ${s.stack}`}>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Type</th>
              <th scope="col">Default</th>
              <th scope="col">Since</th>
              <th scope="col">Locked</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              if (r.kind === "checks") {
                return (
                  <tr key="checks-family" id="key-checks-id">
                    <th scope="row"><code>checks.&lt;id&gt;.enabled</code> and <code>.severity</code></th>
                    <td data-label="Type">boolean, enum</td>
                    <td data-label="Default"><code>true</code>, <span className={s.muted}>none</span></td>
                    <td data-label="Since"><span className={s.muted}>see the check</span></td>
                    <td data-label="Locked">locked{CANDIDATES.length ? <span className={s.muted}> (not for candidate checks: {CANDIDATES.join(", ")})</span> : null}</td>
                    <td data-label="Meaning">Both exist for every check, so they are listed once here, and not repeated on each check page. <code>enabled: false</code> reports the check as n/a (&quot;disabled by config&quot;) so it stays visible. <code>severity</code> is <code>critical</code>, <code>scored</code> or <code>advisory</code> and overrides how the check counts; none keeps the check&apos;s own severity, and <code>advisory</code> removes it from the score.</td>
                  </tr>
                );
              }
              if (r.kind === "servers") {
                return (
                  <tr key="servers-family" id="key-servers">
                    <th scope="row"><code>servers.&lt;name&gt;.*</code></th>
                    <td data-label="Type">map of server</td>
                    <td data-label="Default"><span className={s.muted}>none</span></td>
                    <td data-label="Since">0.2-draft</td>
                    <td data-label="Locked"><span className={s.muted}>no</span></td>
                    <td data-label="Meaning">Several servers in one file. Each entry takes the same keys as <code>server</code>: <code>command</code>, <code>args</code>, <code>env</code>, <code>url</code>, <code>start_timeout_sec</code>, <code>headers</code> and <code>files</code>, with the same meaning. Use either <code>server</code> or <code>servers</code>, never both; <code>run.server</code> picks the entry.</td>
                  </tr>
                );
              }
              const k = r.key;
              return (
                <tr key={k.path} id={keyId(k.path)} className={k.deprecated ? s.deprecated : undefined}>
                  <th scope="row"><code>{k.path}</code></th>
                  <td data-label="Type">{k.type}</td>
                  <td data-label="Default">{k.default === null || k.default === undefined ? <span className={s.muted}>none</span> : <code>{typeof k.default === "string" ? k.default : JSON.stringify(k.default)}</code>}</td>
                  <td data-label="Since">{k.since}</td>
                  <td data-label="Locked">{k.standardLocked ? "locked" : <span className={s.muted}>no</span>}</td>
                  <td data-label="Meaning">{k.deprecated ? <strong>deprecated. </strong> : null}{k.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className={s.h2} id="profiles">Profiles</h2>
      <p className={s.note}>Chosen with the <code className={s.code}>profile</code> key or <code className={s.code}>--profile</code>. A profile may extend another; you can add your own under <code className={s.code}>profiles</code>.</p>
      <div className="tw">
        <table className={`${s.tbl} ${s.stack}`}>
          <thead>
            <tr>
              <th scope="col">Profile</th>
              <th scope="col">Run</th>
              <th scope="col">Extends</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {PROFILES.map((p) => (
              <tr key={p.name}>
                <th scope="row"><code>{p.name}</code></th>
                <td data-label="Run">{p.standard ? "can be STANDARD" : "always CUSTOM"}</td>
                <td data-label="Extends">{p.extends ? <code>{p.extends}</code> : <span className={s.muted}>none</span>}</td>
                <td data-label="Meaning">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.prose}>
        <Prose file="reference/configuration" />
      </div>
    </article>
  );
}
