// A private store for the text of held security findings, kept between fleet runs.
//
// server-results.json is public (fleet/redact-results.mjs blanks held text at write), and a runner has no state between runs,
// so a held server that is not re-tested in a run would have no text for its private report. The text is kept here, encrypted
// (AES-256-GCM, key derived with HKDF from the FLEET_STORE_KEY secret) in fleet/owner-private-store.enc. The file is public
// ciphertext: without the secret the content, the server names and the count are unreadable; its size roughly follows how much
// text is held, and it is rewritten only when the content changes. With no key set, nothing is stored and the handoff is for
// the current run only, as before.
// Rotating or losing the key: an unreadable store is never overwritten (every run logs an error and uses this run's text only).
// To recover, delete fleet/owner-private-store.enc in a reviewed change; held servers regain text at their next re-test.
import crypto from "node:crypto";
import fs from "node:fs";
import { withheldCheckIds } from "./redact-results.mjs";

export const STORE_FILE = "fleet/owner-private-store.enc";
const INFO = "sealmark fleet private store v1";

const keyFor = (secret, salt) => Buffer.from(crypto.hkdfSync("sha256", Buffer.from(String(secret), "utf8"), salt, INFO, 32));

/** @returns {string} base64 of salt(16) | iv(12) | tag(16) | ciphertext of the JSON of `servers` */
export function encryptStore(servers, secret) {
  if (!secret) throw new Error("no store key");
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(secret, salt), iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ v: 1, servers }), "utf8"), c.final()]);
  return Buffer.concat([salt, iv, c.getAuthTag(), ct]).toString("base64") + "\n";
}

/** The servers object, or throws (wrong key, damaged file). */
export function decryptStore(text, secret) {
  if (!secret) throw new Error("no store key");
  const b = Buffer.from(String(text).trim(), "base64");
  if (b.length < 45) throw new Error("store too short");
  const d = crypto.createDecipheriv("aes-256-gcm", keyFor(secret, b.subarray(0, 16)), b.subarray(16, 28));
  d.setAuthTag(b.subarray(28, 44));
  const o = JSON.parse(Buffer.concat([d.update(b.subarray(44)), d.final()]).toString("utf8"));
  if (o?.v !== 1 || typeof o.servers !== "object" || o.servers === null) throw new Error("store format");
  return o.servers;
}

const sameResult = (k, s) => k && k.testedAt === s.testedAt && k.versionTested === s.versionTested && k.sealmark === (s.sealmark?.version ?? null);

/**
 * The servers to keep after a merge: this run's removed text, plus the text kept for a server that is still held and whose
 * result did not change. A server that is no longer held, or was re-tested without new text, is dropped.
 */
export function nextStore({ prev, removed, results, entries, today }) {
  const out = {};
  for (const s of results.servers ?? []) {
    if (!withheldCheckIds(s, entries ?? {}, today).size) continue;
    const kept = sameResult(prev?.[s.id], s) ? prev[s.id] : null;
    const k = removed[s.id] ? { ...removed[s.id], summaries: { ...(kept?.summaries ?? {}), ...removed[s.id].summaries } } : kept;
    if (k && Object.keys(k.summaries ?? {}).length) out[s.id] = k;
  }
  return out;
}

/**
 * Load, update and save the store; returns the servers to hand to this run's private reports.
 * Without a key: this run's text only. A store that cannot be read is left untouched (never overwritten).
 */
export function updateStore({ file = STORE_FILE, secret, removed, results, entries, today, log = () => {} }) {
  if (!secret) return removed;
  let prev = {};
  if (fs.existsSync(file)) {
    try { prev = decryptStore(fs.readFileSync(file, "utf8"), secret); }
    catch { log("::error::fleet/owner-private-store.enc cannot be read with FLEET_STORE_KEY: left as it is, this run's text only"); return removed; }
  }
  const next = nextStore({ prev, removed, results, entries, today });
  if (!fs.existsSync(file) || JSON.stringify(prev) !== JSON.stringify(next)) fs.writeFileSync(file, encryptStore(next, secret));
  return next;
}
