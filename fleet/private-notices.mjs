// Private email notices for security findings held back from public owner issues (fleet/notify-owners.mjs holds them
// in the gitignored fleet/owner-private-queue.json). Nothing here sends mail or writes a file: it finds a contact,
// renders the plain-text notice and computes the disclosure and ledger updates. Never commit a queue, a draft or an
// address; this repository is public. Policy: https://sealmark.dev/disclosure/
//
// Contact, in this order: the security contact in the repository's SECURITY.md; the npm or PyPI maintainer address;
// the owner's public GitHub profile address. Never a commit address. GitHub private vulnerability reporting is
// recorded separately (pvr) and filed in addition where it is enabled.
export const REPLY_DAYS = 14;
export const REMIND_DAYS = 7;
export const PUBLISH_DAYS = 90;
const DAY = 86_400_000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const BAD = /(^|[.@-])(noreply|no-reply|donotreply)|@users\.noreply\.github\.com$|@(example\.(com|org|net)|localhost)$|\.(internal|local|test|invalid|localhost|example)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const clean = (list) => [...new Set(list.map((e) => e.replace(/[.,;:)\]>]+$/, "").toLowerCase()))].filter((e) => !BAD.test(e));

/** Addresses named in a SECURITY.md. @param {string|null|undefined} text */
export function parseSecurityMd(text) {
  const t = String(text ?? "");
  const about = t.split(/\r?\n/).filter((l) => /secur|vulnerab|disclos|report|\bcontact\b/i.test(l)).join("\n");
  const noUrls = about.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (u) => u.replace(/\/\/[^@/\s]*@/, "//")); // user:pass@host in a URL is not an address
  return { emails: clean(noUrls.match(EMAIL) ?? []), route: /advisor|hackerone|bugcrowd|https?:\/\/\S+/i.test(t) };
}

/** First usable maintainer or author address in npm package metadata. */
export function emailFromNpm(meta) {
  const all = [...(meta?.maintainers ?? []), meta?.author, ...(meta?.contributors ?? [])].map((p) => p?.email).filter(Boolean);
  return clean(all)[0] ?? null;
}

/** Author or maintainer address in PyPI JSON metadata. */
export function emailFromPypi(meta) {
  const raw = [meta?.info?.author_email, meta?.info?.maintainer_email].filter(Boolean).join(" ");
  return clean(raw.match(EMAIL) ?? [])[0] ?? null;
}

/**
 * @param {{repo: string|null, ecosystem?: string, pkg?: string}} x
 * @param {{get: (url: string) => Promise<any>}} deps get returns parsed JSON, or {missing: true}; for file contents {text}.
 * @returns {Promise<{channel: "security-policy"|"security-policy-link"|"package-maintainer"|"github-profile"|"none", email: string|null, pvr: boolean|null}>}
 */
export async function resolveContact({ repo, ecosystem, pkg }, { get }) {
  const safe = async (url) => { try { return (await get(url)) ?? { missing: true }; } catch { return { missing: true }; } };
  let pvr = null;
  if (repo) {
    const r = await safe(`https://api.github.com/repos/${repo}/private-vulnerability-reporting`);
    pvr = r.missing ? null : r.enabled === true;
    for (const path of ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"]) {
      const f = await safe(`https://api.github.com/repos/${repo}/contents/${path}`);
      if (f.missing) continue;
      const md = parseSecurityMd(f.text);
      if (md.emails.length) return { channel: "security-policy", email: md.emails[0], pvr };
      if (md.route) return { channel: "security-policy-link", email: null, pvr }; // the policy names a form or advisory route: follow it by hand
    }
  }
  if (pkg) {
    const url = ecosystem === "pypi" ? `https://pypi.org/pypi/${pkg}/json` : `https://registry.npmjs.org/${pkg}/latest`;
    const m = await safe(url);
    const e = m.missing ? null : ecosystem === "pypi" ? emailFromPypi(m) : emailFromNpm(m);
    if (e) return { channel: "package-maintainer", email: e, pvr };
  }
  if (repo) {
    const u = await safe(`https://api.github.com/users/${repo.split("/")[0]}`);
    const e = u.missing ? null : clean(u.email ? [u.email] : [])[0] ?? null;
    if (e) return { channel: "github-profile", email: e, pvr };
  }
  return { channel: "none", email: null, pvr };
}

/** The plain-text notice for one held repository. No HTML, no links that track. */
export function renderNotice({ entry, replyTo, today }) {
  const servers = entry.servers.filter((s) => s.security.length);
  const names = servers.map((s) => `${s.name} ${s.version}`).join(", ");
  const blocks = servers.map((s) => [
    `${s.name} ${s.version} (tested ${s.testedAt}, grade ${s.letter ?? "not graded"})`,
    ...s.security.map((c) => `  - ${c.label} [${c.id}]: ${c.summary}`),
    `  Reproduce it yourself: ${s.rerun}`,
    `  Full result: ${s.results}`,
  ].join("\n")).join("\n\n");
  const text = [
    `Hello,`,
    `I run Sealmark (https://sealmark.dev), an open-source test suite that starts an MCP server, calls its tools with fixed inputs and records what it actually did. An automated run of ${names} found behavior in your repository (${entry.repo ?? "package listed above"}) that looks like a security problem. I am writing to you privately first, and I will not post it anywhere public before you have had a chance to respond.`,
    `What the run found:\n\n${blocks}`,
    `The run is deterministic and uses no AI model, so the command above should show you the same result. It can be wrong; if you think it is, tell me and I will recheck it.`,
    `Timeline: please reply within ${REPLY_DAYS} days. I will send one reminder after ${REMIND_DAYS} days if I have not heard from you. I publish the details when a fixed version is out or on day ${PUBLISH_DAYS}, whichever comes first. If you need longer, say so and we can talk.`,
    `The policy is at https://sealmark.dev/disclosure/. This message has no tracking in it. Reply to this email (${replyTo}) to reach me.`,
    `Jordan Allen Lewis\nSealmark (https://sealmark.dev)`,
  ].join("\n\n") + "\n";
  return { subject: `Private security report for ${entry.repo ?? names}: Sealmark test results`, text };
}

/** Disclosure and ledger after a notice went out. Pure: returns copies. Never stores an address. */
export function recordReported({ disclosure, ledger, entry, channel, today }) {
  const d = structuredClone(disclosure);
  const l = structuredClone(ledger);
  for (const s of entry.servers) for (const c of s.security) {
    const key = `${s.id}/${c.id}`;
    if (d.findings[key]) d.findings[key] = { status: "reported", reportedAt: today, publishAfter: addDays(today, PUBLISH_DAYS) };
  }
  (l.emails ??= []).push({ repo: entry.repo, channel, at: today, remindAfter: addDays(today, REMIND_DAYS), replyBy: addDays(today, REPLY_DAYS) });
  return { disclosure: d, ledger: l };
}
