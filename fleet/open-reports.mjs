// Opens the sealed reports of a fleet run (collect job). The test jobs seal each report with a public key
// (vars.FLEET_REPORT_PUBKEY) before it is uploaded, so the public artifact holds no finding text; the private key
// (secrets.FLEET_REPORT_PRIVATE_KEY) exists only in this step. Usage: node fleet/open-reports.mjs <reportsDir>
// A report that was never sealed is left as it is. Sealed reports with no key fail the step: reading them as
// "no report" would record every server as a failed attempt.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function openReports(dir, privPem, run = execFileSync) {
  const sealed = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name))
    .filter((p) => fs.existsSync(path.join(p, "sealmark.json.enc")));
  if (!sealed.length) return { opened: 0, failed: 0, sealed: 0 };
  if (!privPem) throw new Error(`${sealed.length} sealed reports and no FLEET_REPORT_PRIVATE_KEY`);
  const tmp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "seal-"));
  const keyFile = path.join(tmp, "priv.pem");
  fs.writeFileSync(keyFile, privPem.endsWith("\n") ? privPem : privPem + "\n", { mode: 0o600 });
  let opened = 0, failed = 0;
  try {
    for (const p of sealed) {
      const pass = path.join(tmp, "pass");
      try {
        run("openssl", ["pkeyutl", "-decrypt", "-inkey", keyFile, "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256",
          "-in", path.join(p, "sealmark.key.enc"), "-out", pass], { stdio: "ignore" });
        run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", `file:${pass}`, "-in", path.join(p, "sealmark.json.enc"), "-out", path.join(p, "sealmark.json")], { stdio: "ignore" });
        opened++;
      } catch { failed++; }
      fs.rmSync(pass, { force: true });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { opened, failed, sealed: sealed.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = openReports(process.argv[2] ?? "reports", process.env.FLEET_REPORT_PRIVATE_KEY ?? "");
    console.log(`sealed reports: ${r.sealed}, opened ${r.opened}, failed ${r.failed}`);
    if (r.sealed && !r.opened) { console.log("::error::no sealed report could be opened (wrong FLEET_REPORT_PRIVATE_KEY?)"); process.exit(1); }
    if (r.failed) console.log(`::warning::${r.failed} sealed reports could not be opened; those servers count as having no report`);
  } catch (e) { console.log(`::error::${e.message}`); process.exit(1); }
}
