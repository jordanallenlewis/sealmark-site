# sealmark-site

The website at [sealmark.dev](https://sealmark.dev) and the fleet that keeps its results current. Public. The tool itself lives in the public repository [jordanallenlewis/sealmark](https://github.com/jordanallenlewis/sealmark).

| Path | What |
|---|---|
| `web/` | Next.js static site: docs, results pages. `cd web && npm ci && npm run dev` |
| `web/content/data/server-results.json` | The one data file behind the results pages |
| `fleet/` | `plan.mjs` picks servers to re-test (new versions, stale results, a few new ones from the MCP Registry); `merge.mjs` folds the reports into the results file and `history.jsonl` |
| `web/worker/` | The Worker in front of the static site: only `/api/notify/*` (grade-change email alerts, D1 `sealmark-notify`, hourly cron). `notify-core.mjs` holds the email and issue texts |
| `fleet/notify-owners.mjs` | One GitHub issue per server repository on its first grade; drafts in `fleet/owner-issues-draft.md` until switched on |
| `fleet/impact.mjs` | What happened to grades after owners were told, against a never-notified base rate: `fleet/impact-summary.md` (internal, not on the site) |
| `.github/workflows/fleet.yml` | Re-test every 6 hours (and by hand) on GitHub-hosted machines; commits the new grades and deploys when `CLOUDFLARE_API_TOKEN` is set |
| `.github/workflows/release-sync.yml` | Follows every Sealmark release (release dispatch, a 30-minute poll, or by hand): pins the CLI, regenerates the docs, commits, deploys and checks the live site |
| `.github/workflows/fleet-check.yml` | Checks changes to `fleet/` on pull requests |
| `.github/workflows/web.yml` | Build, docs checks and lint on every change to `web/` |
| `site/index.html` | The original single-file mockup |

The docs pages are generated from the published CLI: `web/package.json` pins `sealmark`, and `npm run docs:gen` reads `node_modules/sealmark`. Bump that version when a new CLI is released, then run `npm run docs:gen` and `npm run schema:sync`.

Deploys: `fleet.yml` and `release-sync.yml` deploy `main` automatically. By hand: `cd web && npm run build && npx wrangler deploy`.

Secrets: `FLEET_EXCLUDE` (a regular expression of package names the fleet must not grade), `CLOUDFLARE_API_TOKEN` (deploy; also needs D1 edit and Email Sending for the Worker's bindings, and D1 read for `impact.mjs`) and the optional `SEALMARK_ISSUES_TOKEN` (files grading issues in the sealmark repository).

Owner notices, both off until switched on:

- **Email alerts** (results-page form, double opt-in): set the Worker secret `NOTIFY_SECRET` (`cd web && npx wrangler secret put NOTIFY_SECRET`, any long random string; without it the form answers "not set up yet"), then change `vars.NOTIFY_LIVE` in `web/wrangler.jsonc` to `"1"` and deploy. Until then every email is logged, not sent. Privacy note: `/notify/`.
- **GitHub issues to owners**: add the secret `OWNER_ISSUES_TOKEN` (a token that can open issues on public repositories) and set the repository variable `OWNER_ISSUES_LIVE` to `1`. Until both are set, `fleet/owner-issues-draft.md` shows what would be filed. At most 8 per run; never on archived repos, forks, repos with issues off, our own repos, or repos in `fleet/owner-optout.json` (a reply of "opt out" adds them, forever).