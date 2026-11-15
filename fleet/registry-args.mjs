// Fixed launch arguments from an MCP Registry package entry, for fleet/plan.mjs and fleet/merge.mjs.
//
// Many registry packages start their MCP server with a subcommand (`<pkg> mcp`, `<pkg> serve --transport stdio`) and
// say so in `packageArguments`. The planner used to start every package bare, so those servers never answered and
// sat in "Not graded yet". Only arguments with a fixed `value` are used: a `valueHint` or a `{placeholder}` is
// something a user fills in, and we never guess it. `runtimeArguments` (flags for npx or uvx themselves, such as
// `--package` or `--from`) change which program runs, so a package that declares any keeps the bare launch.

// A value the CLI can pass as one argument with no quoting: no spaces, quotes, `$`, `{`, `}`, `;`, `|`, `&` or backticks.
const SAFE_VALUE = /^[A-Za-z0-9._:/@=+,%-]+$/;
const SAFE_NAME = /^--?[A-Za-z0-9][A-Za-z0-9._-]*$/;

const fixed = (a) => (typeof a?.value === "string" && SAFE_VALUE.test(a.value) ? a.value : null);

/**
 * The arguments to put after the package in the launch line, as an array of strings.
 * [] = start the package bare (no arguments declared, or some the planner cannot fill in safely, or runtime arguments).
 * null = the package cannot start without a value we do not have (a required argument with no fixed value).
 */
export function registryArgs(pkg) {
  const declared = Array.isArray(pkg?.packageArguments) ? pkg.packageArguments : [];
  const required = declared.some((a) => a?.isRequired === true && fixed(a) === null);
  if (required) return null;
  if (Array.isArray(pkg?.runtimeArguments) && pkg.runtimeArguments.length > 0) return [];
  const out = [];
  for (const a of declared) {
    const value = fixed(a);
    if (a?.type === "positional") {
      // A positional without a fixed value would shift every argument after it: keep the bare launch instead.
      if (value === null) return [];
      out.push(value);
    } else if (a?.type === "named") {
      if (typeof a.name !== "string" || !SAFE_NAME.test(a.name)) return [];
      // An optional named argument with no fixed value is left to the server's own default.
      if (value === null) continue;
      out.push(a.name, value);
    } else {
      return [];
    }
  }
  return out;
}

/** The launch line for a registry package at a version, with its fixed arguments. */
export function registryLaunch(registryType, identifier, version, args = []) {
  const base = registryType === "npm" ? "npx -y " + identifier + "@" + version : "uvx " + identifier + "==" + version;
  return args.length ? base + " " + args.join(" ") : base;
}

/**
 * Key for "this server already failed at this version with these arguments". History records written before the
 * planner passed arguments have no `args`, which is the same as a bare launch, so they still block a bare retry but
 * not a first try with the arguments the registry declares.
 */
export function failedKey(id, version, args) {
  const a = Array.isArray(args) && args.length ? " " + args.join(" ") : "";
  return id + "@" + (version ?? "") + a;
}

/** The `args` to keep on a fleet record from a matrix entry: only a non-empty array of strings, else nothing. */
export function recordArgs(meta) {
  const a = meta?.args;
  return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === "string") ? { args: a } : {};
}

/** Every failedKey in fleet/history.jsonl's text; a bad line is skipped. */
export function failedKeys(text) {
  const out = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r?.status === "failed" && r.id) out.add(failedKey(r.id, r.version, r.args));
    } catch {
      // skip a bad line
    }
  }
  return out;
}
