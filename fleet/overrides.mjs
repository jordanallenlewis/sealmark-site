// Launch overrides (fleet/overrides.json): what the planner can run. Shared by plan.mjs and fleet-check's tests.

// A launch a fleet VM can run. `<workspace>` stands for a local checkout, which a fleet VM never has, so the planner skips it.
export function canPlan(launch) {
  return typeof launch === "string" && !launch.includes("<workspace>");
}

// Ids of overrides that can never produce a re-test, sorted: not a string, blank, or refused by canPlan. (plan.mjs would skip a
// non-string and would schedule a blank one only to fail, so either way the server keeps its old grade.)
// A server with such an override keeps its last grade forever, so fleet-check fails on any.
export function unplannableOverrides(overrides) {
  return Object.entries(overrides ?? {})
    .filter(([, launch]) => typeof launch !== "string" || launch.trim() === "" || !canPlan(launch))
    .map(([id]) => id)
    .sort();
}
