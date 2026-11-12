// Which Sealmark checks a public owner issue may name, the one list the owner notices use (fleet/notify-owners.mjs).
//
// Fail closed. Only the checks on the PUBLIC list below may be named in a public GitHub issue. A failing (or partly
// passing) non-advisory check that is NOT on that list, including any check a newer CLI adds later, is treated as a
// possible vulnerability in someone else's server: under the disclosure policy (web/content/docs/disclosure.mdx) it
// is reported privately first, so the whole repository goes to the private queue, never to a public issue.
//
// The public results pages (web/lib/disclosure.mjs) import this classification too: a check this file does not list as
// PUBLIC or ADVISORY is redacted there while its finding is under private disclosure.
//
// Every check in the registry (web/content/generated/checks.json) is classified here by hand, and
// fleet/notify.test.mjs fails when the registry gains a check that is not: a new check must be classified on purpose.
import registry from "../web/content/generated/checks.json" with { type: "json" };

// Safe to name publicly: robustness, limits and protocol hygiene. A failure here says the server is fragile or
// unbounded, not that a security boundary was crossed.
export const PUBLIC = {
  protocol: "MCP handshake and tool schemas",
  "robust-input": "survives malformed tool input",
  "db-rowcap": "row cap on query results",
  "db-timeout": "statement timeout",
  "http-protocol-version": "MCP protocol version header",
  "fs-size-cap": "file size cap",
  "net-caps": "response size and time caps on fetches",
  "sqlite-rowcap": "row cap on SQLite results",
  "sqlite-timeout": "SQLite query timeout",
  "exec-timeout-cap": "command timeout",
  "sql-guard-rowcap": "row cap behind a SQL guard",
  "upstream-slow": "a slow upstream is handled",
};

// Held for private handling when they fail or partly pass (the reason each one is a security matter). Listed so the
// classification is explicit; the rule itself is "not PUBLIC and not advisory", so a check missing from both lists
// is held too.
export const PRIVATE = {
  "tool-poisoning": "hidden instructions in tool metadata",
  "secret-echo": "an environment secret comes back in a reply",
  "read-only": "a read-only database server lets a write through",
  rls: "row-level security defeated",
  "mutating-sql": "a mutating SQL statement ran",
  pii: "a column the role may not read was served",
  "pii-masked": "a masked view was bypassed and personal data served",
  "http-origin": "requests from a foreign Origin are served (DNS rebinding)",
  "http-auth": "requests without credentials are served",
  "http-session": "missing or forged session ids are accepted",
  "http-cors": "permissive CORS lets other origins call the server",
  "fs-read-escape": "a file outside the allowed folder was read",
  "fs-write-escape": "a file outside the allowed folder was written",
  "fs-link-escape": "a link led outside the allowed folder",
  "git-repo-scope": "a repository outside the allowed one was reached",
  "git-arg-injection": "git options were injected through arguments",
  "net-loopback-ssrf": "a loopback or internal address was fetched (SSRF)",
  "net-scheme-allowlist": "a disallowed URL scheme was fetched",
  "net-redirect": "a redirect to a refused target was followed (SSRF through a redirect)",
  "sqlite-read-only": "a read-only SQLite server lets a write through",
  "sqlite-mutating-sql": "a mutating SQLite statement ran",
  "sqlite-file-read": "SQLite read a file outside the database",
  "sqlite-file-write": "SQLite wrote a file outside the database",
  "sqlite-extension-load": "SQLite loaded an extension",
  "exec-injection": "command injection",
  "exec-cwd": "a program runs outside the configured root",
  "scope-escape": "an identifier outside the allowed scope was served",
  "sql-guard-statements": "a statement the SQL guard should refuse ran",
  "sql-guard-references": "an object the SQL guard should refuse was reached",
  "upstream-credential": "the upstream credential is exposed",
  "upstream-credential-echo": "a caller's credential comes back in a reply",
  "log-secret": "a caller's credential is written to the server's log",
  "upstream-error-leak": "an upstream error body is relayed with the credential",
  "upstream-token-passthrough": "the caller's token is passed through upstream",
  "oauth-token-forgery": "a forged token is accepted",
  "oauth-claims": "a token with wrong claims is accepted",
  "oauth-discovery": "OAuth discovery metadata (part of the auth boundary)",
  "oauth-scope": "scopes not enforced, or tokens read from the URL",
  "annotation-honesty": "a tool declared read-only changes things",
  "openworld-honesty": "a tool declared closed-world reaches the network",
};

// Advisory checks never change the grade and are never named in an issue, so they neither hold nor list.
export const ADVISORY = ["refusal-quality", "instructions-hygiene", "write-gate", "audit", "db-privilege", "http-session-binding", "http-bind", "http-tls", "exec-allowlist", "undeclared-writes"];

// id -> "public" | "private" | "advisory" for every check this file knows.
export const CHECK_CLASS = Object.fromEntries([
  ...Object.keys(PUBLIC).map((id) => [id, "public"]),
  ...Object.keys(PRIVATE).map((id) => [id, "private"]),
  ...ADVISORY.map((id) => [id, "advisory"]),
]);

// Every registry check id this file has not classified (the test wants none).
export const UNCLASSIFIED = registry.map((c) => c.id).filter((id) => !CHECK_CLASS[id]);

// May this check be named in a public issue? Only an allowlisted, scored check that the result does not mark critical.
export function isPublicCheck(check) {
  return Boolean(check) && !check.advisory && check.critical !== true && CHECK_CLASS[check.id] === "public";
}

// Is this a scored check that is not public (a security check, known or not)?
export function isSecurityCheck(check) {
  return Boolean(check) && !check.advisory && !isPublicCheck(check);
}

// Weak signals: results that lower or qualify a grade without showing a problem. Never a finding, never named in an
// issue, and never redacted on the public results pages (web/lib/disclosure.mjs imports WEAK_PART and isWeakSignal).
// In the owner notices, a grade they alone pull below an A waits for a clearer re-test (fleet/notify-owners.mjs).
//   tool-poisoning "part": weak indicators only, none conclusive
//   annotation-honesty "part": a read-only tool changed only caches (the sandbox home or temp)
//   any "inconclusive" verdict
export const WEAK_PART = {
  "tool-poisoning": /^\d+ weak indicator\(s\) worth reading, none conclusive\.?$/,
  "annotation-honesty": /^declared read-only; only caches changed\b/,
};
export function isWeakSignal(check) {
  if (!check || check.advisory) return false;
  if (check.verdict === "inconclusive") return true;
  return check.verdict === "part" && Boolean(WEAK_PART[check.id]?.test(String(check.summary ?? "").trim()));
}

// The security findings on a server: any non-public scored check at "fail", or at "part" unless the part is a known
// weak signal. Inconclusive and n/a are not findings.
export function securityFindings(server) {
  return (server.checks ?? []).filter((c) => isSecurityCheck(c) && (c.verdict === "fail" || (c.verdict === "part" && !isWeakSignal(c))));
}
