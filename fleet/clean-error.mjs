// The error text kept for a failed run (history.jsonl, telemetry.jsonl). npm prints its "new major version" notice when
// a process exits, so on a short-lived failing start the notice was the whole saved tail and the real cause was lost
// (2026-11-17: 76 of 144 never-graded servers showed only the notice). Notice and warning lines carry no cause: drop them.
const NOISE = /^\s*npm\s+(?:notice|warn|WARN)\b/;

export function cleanError(text) {
  if (text == null) return text;
  return String(text).split(/\r?\n/).filter((l) => !NOISE.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
