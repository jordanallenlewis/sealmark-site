#!/usr/bin/env bash
# Forward-only production deploy of web/ to the `sealmark` Worker (fleet.yml and release-sync.yml call this).
#   1. deploy-guard check: the commit being shipped must descend from the commit live now (read from the live
#      Worker version's message `sha=<40 hex>`); an older commit, or an unknown live one, stops here (exit 4).
#   2. wrangler deploy, the new Worker version stamped with its commit (--tag g<12> --message sha=<40>).
#   3. deploy-guard record, then probe: live must equal what was shipped. Drift fails the step (exit 5) and writes an
#      ::error:: annotation, so the run is red and the CI-red signal wakes the owner.
# The guard trusts only a `sha=` in the live version's message. Anything that creates a Worker version without one
# (`wrangler secret put`, a dashboard edit, a hand deploy without the tag flags) makes every automated deploy refuse
# (DENY live-unknown, exit 4) until a stamped deploy of main is done by hand (README, Deploys: re-stamp).
# A deploy that lost a race (a newer commit went live while this one built) is also refused: it is red but safe.
# A rollback is never done here: it is a logged, approved action (deploy-guard check --rollback --approval <id> --reason).
# Test hooks (never set in a workflow): GUARD_LIVE_CMD (prints the live sha), GUARD_DEPLOY_CMD (replaces wrangler deploy), GUARD_PROBE_WAIT (seconds between probes).
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
SHA=$(git -C "$ROOT" rev-parse HEAD)
LEDGER="${GUARD_LEDGER:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/deploy-guard.jsonl}"
export npm_config_yes=true WRANGLER_SEND_METRICS=false
common=(--repo "$ROOT" --ledger "$LEDGER" --task "${GITHUB_RUN_ID:-local}")
live=(--worker sealmark)
[ -z "${GUARD_LIVE_CMD:-}" ] || live=(--live-cmd "$GUARD_LIVE_CMD")
G=(node "$ROOT/fleet/deploy-guard.mjs")

"${G[@]}" check "${common[@]}" "${live[@]}" --target "$SHA"

TAGFLAGS=$("${G[@]}" tag --repo "$ROOT" --target "$SHA")
if [ -n "${GUARD_DEPLOY_CMD:-}" ]; then
  # shellcheck disable=SC2086
  eval "$GUARD_DEPLOY_CMD $TAGFLAGS"
else
  # shellcheck disable=SC2086
  (cd "$ROOT/web" && npx -y wrangler@4 deploy $TAGFLAGS)
fi
"${G[@]}" record "${common[@]}" --target "$SHA"

# the new version can take a few seconds to show as live: retry quietly, alert only on the last try
for i in 1 2 3 4 5 6; do
  if [ "$i" -lt 6 ]; then
    "${G[@]}" probe "${common[@]}" "${live[@]}" --expect "$SHA" 2>/dev/null && exit 0 || sleep "${GUARD_PROBE_WAIT:-10}"
  else
    "${G[@]}" probe "${common[@]}" "${live[@]}" --expect "$SHA" --alert-cmd 'echo "::error::$(cat)"'
  fi
done
