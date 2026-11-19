// Words for the "Not graded yet" list on /results/. The reasons come from fleet/not-graded.mjs (REASONS); each says how
// our default run went, never what the server is worth: none of them is a grade. Many are limits of that default run
// (no secrets, no extra arguments), so no text here may put the cause on the server.

/** @type {Record<string, { label: string; meaning: string }>} */
export const REASON_TEXT = {
  "needs-credentials": { label: "Needs a credential", meaning: "It asked for an API key, a token or a sign-in before starting. The default run gives it none." },
  "dependency-resolution": { label: "Did not install", meaning: "Under the default launch command, its package or one of its dependencies could not be installed or imported." },
  "missing-runtime": { label: "Runtime missing", meaning: "The command it starts with is not on the test machine." },
  "bad-launch": { label: "Refused the launch", meaning: "It rejected the fleet's default launch command: its arguments, its entry point or a setting." },
  "initialize-timeout": { label: "No answer in time", meaning: "It did not answer the MCP handshake within the time limit (60 seconds by default)." },
  "exited-no-error": { label: "Closed without an error", meaning: "It closed the connection while starting and printed no error of its own, so the cause is not known. Re-running it by hand shows more." },
  "needs-service": { label: "Needs another program", meaning: "It looked for a local service or application (a port, a desktop program) that the default run does not provide." },
  "harness-error": { label: "Our run failed", meaning: "Sealmark's own test job broke on it. That one is ours to fix." },
  unknown: { label: "Not classified", meaning: "It did not finish starting under the default run, and its error is not one we classify yet." },
};

/** One row per reason with servers in it: most servers first, then by label. Keys without a label are dropped. */
export function reasonRows(byReason) {
  return Object.entries(byReason ?? {})
    .filter(([reason, count]) => REASON_TEXT[reason] && count > 0)
    .map(([reason, count]) => ({ reason, count, ...REASON_TEXT[reason] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
