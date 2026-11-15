// "Add it to a client" on a results page (site#55). The snippet starts the exact version that was graded, the
// same way the run did, so the page never suggests a setup it did not test. Placeholders that Sealmark fills in
// for a run (a throwaway database or folder) become values the reader replaces. No snippet when the command is
// withheld under private disclosure, wrapped in a fleet shell script, or not a plain npx/uvx command.
import { shellArg } from "./results-copy.mjs";

/** What each run placeholder becomes in a reader's config (docs: /docs/reference/configuration/#placeholders). */
export const FILL = {
  "{dsn}": "postgresql://USER:PASSWORD@HOST:5432/DATABASE",
  "{sandbox}": "/path/to/folder",
  "{dir}": "/path/to/folder",
  "{sandbox_home}": "/path/to/home",
  "{sqlite_path}": "/path/to/database.sqlite",
  "{host}": "HOST",
  "{port}": "5432",
  "{user}": "USER",
  "{password}": "PASSWORD",
  "{database}": "DATABASE",
  "{upstream}": "UPSTREAM_URL",
};

const RUNNERS = new Set(["npx", "uvx"]);
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PLAIN = /^[A-Za-z0-9_\-.,/:=+]+$/;

/**
 * Split a start command into words like a POSIX shell, or null when it holds anything a JSON args list cannot
 * say (expansions, operators, escapes, an unclosed quote).
 * @param {string} s
 */
export function splitLaunch(s) {
  const out = [];
  let cur = "", has = false, q = "";
  for (const ch of s) {
    if (q) {
      if (ch === q) q = "";
      else if (q === '"' && /[$`\\!]/.test(ch)) return null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has) out.push(cur); cur = ""; has = false; continue; }
    if (/[$`\\|&;<>()*?~#!]/.test(ch)) return null;
    cur += ch; has = true;
  }
  if (q) return null;
  if (has) out.push(cur);
  return out;
}

/**
 * @param {{ id: string; transport?: string; launch: string }} x
 * @param {{ withheld?: boolean }} [opt]
 * @returns {{ json: string; claude: string; fill: string[] } | null}
 */
export function installConfig(x, opt = {}) {
  if (opt.withheld || x.transport !== "stdio" || !KEY.test(x.id)) return null;
  const words = splitLaunch(x.launch);
  if (!words || words.length < 2 || !RUNNERS.has(words[0])) return null;
  const fill = new Set();
  const args = [];
  for (const w of words) {
    let bad = false;
    const v = w.replace(/\{[a-z_]+(?::[a-z]+)?\}/g, (p) => {
      if (!(p in FILL)) { bad = true; return p; }
      fill.add(p);
      return FILL[p];
    });
    if (bad || /[{}]/.test(v)) return null;
    args.push(v);
  }
  const [command, ...rest] = args;
  const json = JSON.stringify({ mcpServers: { [x.id]: { command, args: rest } } }, null, 2);
  const claude = `claude mcp add ${x.id} -- ${args.map((a) => (PLAIN.test(a) ? a : shellArg(a))).join(" ")}`;
  return { json, claude, fill: [...fill] };
}
