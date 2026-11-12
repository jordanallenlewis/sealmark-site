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

Secrets: `FLEET_EXCLUDE` (a regular expression of package names the fleet must not grade), `CLOUDFLARE_API_TOKEN` (deploy: Workers Scripts edit is enough for the Worker with its D1, email and cron bindings; D1 read lets `impact.mjs` count sent emails, and without it that step only logs that it could not), the optional `SEALMARK_ISSUES_TOKEN` (files grading issues in the sealmark repository) and `OWNER_ISSUES_TOKEN` (owner issues, below).

Owner notices:

- **Email alerts** (results-page form, double opt-in): on. The Worker secret `NOTIFY_SECRET` is set and `vars.NOTIFY_LIVE` in `web/wrangler.jsonc` is `"1"`; they send from `grades@notify.sealmark.dev`. Kill switch: set `NOTIFY_LIVE` to `"0"` and deploy, and every email is logged instead of sent. Privacy note: `/notify/`.
- **GitHub issues to owners**: posted by the Sealmark bot account (`<BOT_LOGIN>`), never a personal one; the script refuses a token that belongs to an account in `SELF`. The bot account's token is the secret `OWNER_ISSUES_TOKEN`. It must be able to open issues on other people's public repositories: a classic token with the `public_repo` scope (a fine-grained token only reaches repositories the account owns or belongs to). Until it is set, `fleet/owner-issues-draft.md` shows what would be filed.
  - The first batches are approved by hand: read the draft on `main`, then run the fleet workflow by hand with `file_owner_issues` ticked. That run files the top of the draft (re-tests run first, so check the run's draft if grades moved).
  - Then set the repository variable `OWNER_ISSUES_LIVE` to `1` and every run files on its own.
  - `MAX_OWNER_ISSUES` (repository variable) caps issues per run: 2 until it is set; 8 is the planned later value.
  - Never on archived repos, forks, repos with issues off, our own repos, or repos in `fleet/owner-optout.json` (a reply of "opt out" adds them, forever). Only fresh grades: a grade older than 14 days, or one whose latest re-test failed, waits for a new one.
  - Security findings never go in an issue (`fleet/security-checks.mjs` lists the checks). Those repositories are held in `fleet/owner-private-queue.json` and `fleet/owner-private-draft.md`, which are gitignored and never sent: run `node fleet/notify-owners.mjs --dry` locally to see them and report them by hand under the [disclosure policy](https://sealmark.dev/disclosure/).
  - `fleet/owner-weekly.md` (rewritten each week, also in every fleet run's summary) counts issues opened, replies, opt-outs, grade-change emails and letter moves since the notice.