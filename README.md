# sealmark-site

The website at [sealmark.dev](https://sealmark.dev) and the fleet that keeps its results current. Private. The tool itself lives in the public repository [jordanallenlewis/sealmark](https://github.com/jordanallenlewis/sealmark).

| Path | What |
|---|---|
| `web/` | Next.js static site: docs, results pages. `cd web && npm ci && npm run dev` |
| `web/content/data/server-results.json` | The one data file behind the results pages |
| `fleet/` | `plan.mjs` picks servers to re-test (new versions, stale results, a few new ones from the MCP Registry); `merge.mjs` folds the reports into the results file and `history.jsonl` |
| `.github/workflows/fleet.yml` | Re-test every 6 hours (and by hand) on GitHub-hosted machines; commits the new grades and deploys when `CLOUDFLARE_API_TOKEN` is set |
| `.github/workflows/release-sync.yml` | Follows every Sealmark release (release dispatch, a 30-minute poll, or by hand): pins the CLI, regenerates the docs, commits, deploys and checks the live site |
| `.github/workflows/fleet-check.yml` | Checks changes to `fleet/` on pull requests |
| `.github/workflows/web.yml` | Build, docs checks and lint on every change to `web/` |
| `site/index.html` | The original single-file mockup |

The docs pages are generated from the published CLI: `web/package.json` pins `sealmark`, and `npm run docs:gen` reads `node_modules/sealmark`. Bump that version when a new CLI is released, then run `npm run docs:gen` and `npm run schema:sync`.

Deploys: `fleet.yml` and `release-sync.yml` deploy `main` automatically. By hand: `cd web && npm run build && npx wrangler deploy`.

Secrets: `FLEET_EXCLUDE` (a regular expression of package names the fleet must not grade), `CLOUDFLARE_API_TOKEN` (deploy) and the optional `SEALMARK_ISSUES_TOKEN` (files grading issues in the sealmark repository).