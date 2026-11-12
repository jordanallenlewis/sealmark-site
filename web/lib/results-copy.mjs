// Words for a server's results page that depend on its data: coverage, the reproduce command, placeholders, and the
// CLI's reason strings made readable. Pure functions, no I/O: covered by lib/results-copy.test.mjs.

const PLURAL = new Intl.PluralRules("en-US");

/** "1 tool", "2 tools". @param {number} n @param {string} one @param {string} other */
export const count = (n, one, other) => `${n} ${PLURAL.select(n) === "one" ? one : other}`;

/**
 * Capitalizes the first letter and the first letter after a sentence end. An ellipsis ("{dsn}/{host}/... placeholder")
 * is not a sentence end.
 * @param {string} t
 */
export const sentence = (t) => t.replace(/(^|(?<!\.)[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());

/**
 * The CLI says "pack" for a test area. Maintainers read "test area" everywhere on the results pages.
 * @param {string} t
 */
export const plainWords = (t) => t.replace(/\bpacks\b/g, "test areas").replace(/\bpack\b/g, "test area").replace(/\bcore checks\b/g, "protocol checks");

/** Harness placeholders in a start command, in order of first use. @param {string} launch */
export const placeholdersIn = (launch) => [...new Set(launch.match(/\{[a-z_]+(?::[a-z]+)?\}/g) ?? [])];

/**
 * One shell argument for a POSIX shell: double quotes when that is safe, otherwise single quotes.
 * @param {string} s
 */
export function shellArg(s) {
  if (!/["$`\\!]/.test(s)) return `"${s}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The one-line command that repeats the standard run.
 * @param {string} version Sealmark version of the run
 * @param {string} launch the server's start command, placeholders unexpanded
 */
export const reproduceCommand = (version, launch) => `npx -y sealmark@${version} run --start ${shellArg(launch)}`;

/**
 * How much of the server the grade covers, said plainly. `kind` drives the layout:
 *   no-tools  the server declared no tools (it is not presented like a normal grade)
 *   hygiene   tools exist but the grade only covers the handshake and the tool metadata
 *   low       some tools were reached with a valid call, and a deeper test area was graded
 *   covered   the run reached the tools it needed
 *   unknown   the result has no coverage record
 * @param {{ toolCount: number, coverage?: { level: string, toolsCalledValid: number, toolsTotal: number } | null }} server
 * @param {boolean} deepGraded whether a test area other than protocol was graded
 * @returns {{ kind: "no-tools" | "hygiene" | "low" | "covered" | "unknown", text: string }}
 */
export function coverageNote(server, deepGraded) {
  const cov = server.coverage;
  const total = cov ? cov.toolsTotal : server.toolCount;
  if (total === 0 && server.toolCount === 0) {
    return { kind: "no-tools", text: "The server declared no tools under default settings. It probably needs configuration first, such as an API key or a setting, so there was nothing to call and this is not a grade for what the server does." };
  }
  if (!cov) return { kind: "unknown", text: "This result has no record of how many tools were called." };
  const n = cov.toolsCalledValid;
  const reached = n === 0 ? `None of the ${count(total, "tool", "tools")} could be called` : `Only ${n} of ${count(total, "tool", "tools")} could be called`;
  if (cov.level !== "covered" && !deepGraded) {
    return { kind: "hygiene", text: `${reached} with default settings, so this grade covers the handshake and tool metadata only.` };
  }
  if (cov.level !== "covered" && n === 0) {
    return { kind: "low", text: `${reached} with default settings, so no test area saw a tool do its real work.` };
  }
  if (cov.level !== "covered") {
    return { kind: "low", text: `${reached} with default settings, so the deeper test areas cover only ${n === 1 ? "that tool" : "those tools"}.` };
  }
  return { kind: "covered", text: `Tools reached with a valid call: ${n} of ${total}.` };
}
