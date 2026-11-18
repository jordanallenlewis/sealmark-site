// node --test fleet/   Held finding text kept between runs, encrypted; sealed fleet reports (fleet/private-store.mjs, fleet/open-reports.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { decryptStore, encryptStore, nextStore, updateStore } from "./private-store.mjs";
import { redactResults } from "./redact-results.mjs";
import { keptSummary } from "./notify-owners.mjs";
import { openReports } from "./open-reports.mjs";
import { spawnSync } from "node:child_process";

const TODAY = "2026-11-18";
const chk = (id, pack, verdict, summary, over = {}) => ({ id, pack, label: id, critical: false, advisory: false, verdict, summary, ...over });
const server = (id, checks, over = {}) => ({ id, name: id, testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: { version: "1.0.1" }, launch: "npx -y x", checks, ...over });
const held = (over) => server("held", [chk("fs-read-escape", "fs", "fail", "SECRET read_file via evil-dotdot", { critical: true })], over);
const fine = () => server("fine", [chk("fs-read-escape", "fs", "pass", "all reads stayed inside", { critical: true })]);
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "ps-"));

test("encrypt then decrypt returns the same servers; a wrong key or a flipped byte fails; the text is not in the file", () => {
  const servers = { held: { testedAt: "x", versionTested: "1", sealmark: null, summaries: { a: "SECRET read_file" } } };
  const f = encryptStore(servers, "k1");
  assert.deepEqual(decryptStore(f, "k1"), servers);
  assert.ok(!f.includes("SECRET") && !Buffer.from(f.trim(), "base64").toString("latin1").includes("held"));
  assert.throws(() => decryptStore(f, "k2"));
  const b = Buffer.from(f.trim(), "base64"); b[60] ^= 1;
  assert.throws(() => decryptStore(b.toString("base64"), "k1"));
  assert.notEqual(encryptStore(servers, "k1"), f, "fresh salt and iv each write");
  assert.throws(() => encryptStore(servers, ""));
});

test("the text of a held server survives a run that did not re-test it", () => {
  const dir = tmp(), file = path.join(dir, "s.enc");
  const run1 = { servers: [held(), fine()] };
  const rem1 = redactResults(run1, {}, TODAY);
  updateStore({ file, secret: "k", removed: rem1, results: run1, entries: {}, today: TODAY });
  // next run: the public file is already blanked and the server was not re-tested
  const run2 = JSON.parse(JSON.stringify(run1));
  const rem2 = redactResults(run2, {}, TODAY);
  assert.deepEqual(rem2, {}, "nothing left to remove from the public file");
  const handoff = updateStore({ file, secret: "k", removed: rem2, results: run2, entries: {}, today: TODAY });
  assert.equal(keptSummary(run2.servers[0], run2.servers[0].checks[0], handoff), "SECRET read_file via evil-dotdot");
  assert.equal(handoff.fine, undefined);
});

test("a re-test with a new result replaces the kept text; a result that changed without text drops it", () => {
  const prev = { held: { testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: "1.0.1", summaries: { "fs-read-escape": "OLD" } } };
  const newer = { servers: [held({ testedAt: "2026-11-18" })] };
  const rem = redactResults(newer, {}, TODAY);
  assert.equal(nextStore({ prev, removed: rem, results: newer, entries: {}, today: TODAY }).held.summaries["fs-read-escape"], "SECRET read_file via evil-dotdot");
  const blank = { servers: [held({ testedAt: "2026-11-18" })] };
  blank.servers[0].checks[0].summary = null;
  assert.deepEqual(nextStore({ prev, removed: {}, results: blank, entries: {}, today: TODAY }), {}, "old text must not match a newer result");
});

test("a server that is no longer held is dropped from the store", () => {
  const prev = { fine: { testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: "1.0.1", summaries: { a: "x" } } };
  assert.deepEqual(nextStore({ prev, removed: {}, results: { servers: [fine()] }, entries: {}, today: TODAY }), {});
});

test("no key: this run's text only, nothing written; unreadable store: left untouched", () => {
  const dir = tmp(), file = path.join(dir, "s.enc");
  const rem = { held: { summaries: { a: "t" } } };
  assert.equal(updateStore({ file, secret: "", removed: rem, results: { servers: [] }, entries: {}, today: TODAY }), rem);
  assert.ok(!fs.existsSync(file));
  fs.writeFileSync(file, encryptStore({}, "old"));
  const before = fs.readFileSync(file, "utf8");
  const logs = [];
  assert.equal(updateStore({ file, secret: "new", removed: rem, results: { servers: [] }, entries: {}, today: TODAY, log: (m) => logs.push(m) }), rem);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(logs[0], /cannot be read/);
});

// The sealing commands are the ones in .github/workflows/fleet.yml (test job: no secrets, public key only).
const SEAL = [
  'openssl rand -hex 32 > "$D/k"',
  'openssl enc -aes-256-cbc -pbkdf2 -pass "file:$D/k" -in "$O/sealmark.json" -out "$O/sealmark.json.enc"',
  'openssl pkeyutl -encrypt -pubin -inkey "$D/pub.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$D/k" -out "$O/sealmark.key.enc"',
];

test("the workflow seals with exactly these commands", () => {
  const wf = fs.readFileSync(new URL("../.github/workflows/fleet.yml", import.meta.url), "utf8");
  for (const line of SEAL) assert.ok(wf.includes(line.replaceAll("$D", "$RUNNER_TEMP").replaceAll("$O", "out")), line);
});

test("a report sealed with the public key opens with the private key; no key fails; plain reports are left alone", () => {
  const d = tmp(), O = path.join(d, "reports", "report-a"), P = path.join(d, "reports", "report-plain");
  fs.mkdirSync(O, { recursive: true }); fs.mkdirSync(P, { recursive: true });
  execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", path.join(d, "priv.pem")], { stdio: "ignore" });
  execFileSync("openssl", ["pkey", "-in", path.join(d, "priv.pem"), "-pubout", "-out", path.join(d, "pub.pem")], { stdio: "ignore" });
  fs.writeFileSync(path.join(O, "sealmark.json"), '{"secret":"HELD TEXT"}');
  fs.writeFileSync(path.join(P, "sealmark.json"), '{"plain":1}');
  execSync(SEAL.join(" && ") + ' && rm "$O/sealmark.json" "$D/k"', { env: { ...process.env, D: d, O }, shell: "/bin/bash" });
  assert.ok(!fs.readFileSync(path.join(O, "sealmark.json.enc")).includes("HELD TEXT"));
  assert.throws(() => openReports(path.join(d, "reports"), ""), /no FLEET_REPORT_PRIVATE_KEY/);
  const r = openReports(path.join(d, "reports"), fs.readFileSync(path.join(d, "priv.pem"), "utf8").trim());
  assert.deepEqual(r, { opened: 1, failed: 0, sealed: 1 });
  assert.equal(fs.readFileSync(path.join(O, "sealmark.json"), "utf8"), '{"secret":"HELD TEXT"}');
  assert.equal(fs.readFileSync(path.join(P, "sealmark.json"), "utf8"), '{"plain":1}');
  // a different private key cannot open it
  execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", path.join(d, "other.pem")], { stdio: "ignore" });
  fs.rmSync(path.join(O, "sealmark.json"));
  assert.equal(openReports(path.join(d, "reports"), fs.readFileSync(path.join(d, "other.pem"), "utf8")).failed, 1);
  assert.ok(!fs.existsSync(path.join(O, "sealmark.json")));
});

test("a check that becomes withheld later adds to the kept text instead of replacing it", () => {
  const prev = { held: { testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: "1.0.1", summaries: { "fs-read-escape": "EARLIER" } } };
  const results = { servers: [held()] };
  const removed = { held: { testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: "1.0.1", summaries: { "fs-write-escape": "LATER" } } };
  assert.deepEqual(nextStore({ prev, removed, results, entries: {}, today: TODAY }).held.summaries, { "fs-read-escape": "EARLIER", "fs-write-escape": "LATER" });
});

test("the store file is rewritten only when its content changes", () => {
  const dir = tmp(), file = path.join(dir, "s.enc");
  const results = { servers: [held()] }, removed = redactResults(results, {}, TODAY);
  updateStore({ file, secret: "k", removed, results, entries: {}, today: TODAY });
  const first = fs.readFileSync(file, "utf8");
  updateStore({ file, secret: "k", removed: {}, results, entries: {}, today: TODAY });
  assert.equal(fs.readFileSync(file, "utf8"), first);
});

// The run block of the workflow's "seal the report" step, run for real.
const sealStep = () => {
  const wf = fs.readFileSync(new URL("../.github/workflows/fleet.yml", import.meta.url), "utf8");
  const i = wf.indexOf("- name: seal the report"), j = wf.indexOf("run: |\n", i) + 7, k = wf.indexOf("      - uses:", j);
  return wf.slice(j, k).split("\n").map((l) => l.slice(10)).join("\n");
};
const runSeal = (d, pubkey) => spawnSync("bash", ["-e", "-c", sealStep()], { cwd: d, env: { ...process.env, PUBKEY: pubkey, RUNNER_TEMP: d }, encoding: "utf8" });

test("the seal step never leaves a plain report behind: bad key, short key, no key variable", () => {
  for (const [name, key, plain, code] of [["garbage", "not a key", false, 1], ["unset", "", true, 0]]) {
    const d = tmp(); fs.mkdirSync(path.join(d, "out"));
    fs.writeFileSync(path.join(d, "out", "sealmark.json"), '{"s":"HELD"}');
    const r = runSeal(d, key);
    assert.equal(r.status, code, name + r.stderr);
    assert.equal(fs.existsSync(path.join(d, "out", "sealmark.json")), plain, name);
    assert.ok(!fs.existsSync(path.join(d, "out", "sealmark.json.enc")) || !plain, name);
  }
  // a 1024-bit key cannot wrap the 65-byte pass phrase: sealing fails, the plain report is removed
  const d = tmp(); fs.mkdirSync(path.join(d, "out"));
  fs.writeFileSync(path.join(d, "out", "sealmark.json"), '{"s":"HELD"}');
  const small = execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:1024"], { stdio: ["ignore", "pipe", "ignore"] });
  const pub = execFileSync("openssl", ["pkey", "-pubout"], { input: small, stdio: ["pipe", "pipe", "ignore"] }).toString();
  const r = runSeal(d, pub);
  assert.equal(r.status, 1);
  assert.deepEqual(fs.readdirSync(path.join(d, "out")), []);
});

test("the seal step with a good key leaves only sealed files", () => {
  const d = tmp(); fs.mkdirSync(path.join(d, "out"));
  fs.writeFileSync(path.join(d, "out", "sealmark.json"), '{"s":"HELD"}');
  const priv = execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072"], { stdio: ["ignore", "pipe", "ignore"] });
  const pub = execFileSync("openssl", ["pkey", "-pubout"], { input: priv, stdio: ["pipe", "pipe", "ignore"] }).toString();
  assert.equal(runSeal(d, pub).status, 0);
  assert.deepEqual(fs.readdirSync(path.join(d, "out")).sort(), ["sealmark.json.enc", "sealmark.key.enc"]);
  assert.ok(!fs.existsSync(path.join(d, "k")));
});

test("open-reports CLI: exit 1 when sealed reports cannot be opened, 0 when there are none", () => {
  const d = tmp(), O = path.join(d, "reports", "report-a");
  fs.mkdirSync(O, { recursive: true });
  const cli = new URL("./open-reports.mjs", import.meta.url).pathname;
  const run = (env) => spawnSync("node", [cli, path.join(d, "reports")], { env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(run({ FLEET_REPORT_PRIVATE_KEY: "" }).status, 0);
  fs.writeFileSync(path.join(O, "sealmark.json.enc"), "x"); fs.writeFileSync(path.join(O, "sealmark.key.enc"), "x");
  const none = run({ FLEET_REPORT_PRIVATE_KEY: "" });
  assert.equal(none.status, 1); assert.match(none.stdout, /::error::.*no FLEET_REPORT_PRIVATE_KEY/);
  const bad = run({ FLEET_REPORT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" });
  assert.equal(bad.status, 1); assert.match(bad.stdout, /::error::no sealed report could be opened/);
});
