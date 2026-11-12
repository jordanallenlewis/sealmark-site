// Which Sealmark checks are security findings, the one list the owner notices use (fleet/notify-owners.mjs).
//
// A failing security check is a possible vulnerability in someone else's server. Under the disclosure policy
// (web/content/docs/disclosure.mdx) it is reported privately first, through a GitHub Security Advisory on the
// server's repository, never in a public issue. So a repository with one goes to the private queue, not to a
// public owner issue.
//
// The list is derived, not hand-copied:
//   1. every check the registry marks critical (severity "critical" in web/content/generated/checks.json, the
//      checks whose failure caps a grade at D; see the methodology's critical cap): filesystem, git, exec and
//      SQL escapes, SSRF and scheme bypasses, row-level security, personal data, secret echo, tool poisoning,
//      token forgery and passthrough, and the effects pack's annotation honesty;
//   2. plus the scored checks below, which test a security boundary but do not cap the grade;
//   3. plus any check a result itself marks critical (a newer CLI may ship a critical check before the registry
//      copy here is regenerated).
// Advisory checks never count: they do not affect the grade and the owner issue never lists them.
import registry from "../web/content/generated/checks.json" with { type: "json" };

// Scored (not critical) checks that are still security findings, with the reason.
export const SECURITY_SCORED = {
  "net-redirect": "redirect to a target the URL rules would refuse (SSRF through a redirect)",
  "exec-cwd": "a program runs outside the configured root",
  "http-auth": "requests without credentials are served",
  "http-session": "missing or forged session ids are accepted",
  "http-cors": "permissive CORS lets other origins call the server",
  "oauth-scope": "scopes not enforced, or tokens read from the URL",
  "upstream-credential-echo": "a caller's credential comes back in a reply",
  "log-secret": "a caller's credential is written to the server's log",
  "upstream-error-leak": "an upstream error body is relayed with the credential",
};

export const SECURITY_CHECKS = new Set([
  ...registry.filter((c) => c.severity === "critical" || c.critical === true).map((c) => c.id),
  ...Object.keys(SECURITY_SCORED),
]);

export function isSecurityCheck(check) {
  if (!check || check.advisory) return false;
  return SECURITY_CHECKS.has(check.id) || check.critical === true;
}

// Checks whose "part" verdict means part of the attack got through (one mutating-SQL form ran: the CLI prints these
// as "critical part"). For the other security checks "part" is a weak signal, not a finding: tool-poisoning's
// "weak indicators, none conclusive", annotation-honesty's "only caches changed", a data: URL accepted with no file
// read. The owner issue never lists a part verdict either way.
export const PART_IS_FINDING = new Set(["mutating-sql", "sqlite-mutating-sql", "sql-guard-statements", "sql-guard-references"]);

// The security findings on a server: a security check at "fail", or at "part" where part means a partial bypass.
// Inconclusive and n/a are not findings.
export function securityFindings(server) {
  return (server.checks ?? []).filter((c) => isSecurityCheck(c) && (c.verdict === "fail" || (c.verdict === "part" && PART_IS_FINDING.has(c.id))));
}
