# Product

<!-- impeccable:product-schema 1 -->

<!-- Sources: jordanallenlewis/sealmark-site origin/main 04e850e and jordanallenlewis/sealmark origin/main 550a716 (fetched 2026-11-14), the founding docs in Desktop\sealmark-private\internal-docs\docs, Hannah's (hq-sealmark) CLAUDE.md, and Jordan's answers on 2026-11-14. -->

## Platform

web

## Users

- **Primary (Jordan, 2026-11-14): people who build or maintain an MCP server and run Sealmark on it**, from a terminal or in CI, to see what their tools actually do and to gate a release on a grade (`npx sealmark run --fail-under B`). The README, the hero ("See what your MCP server actually does") and the docs ("MCP servers you run or build") all address this person.
- **People choosing or vetting public MCP servers** who read `/results/`: one page per graded public server, with evidence, grade history and a grade-change email form. The 2026-10-08 persona review modelled them as a platform engineer picking between two Postgres servers and an AppSec reviewer vetting servers for a company rollout. They come second (Jordan, 2026-11-14).
- **Maintainers of graded public servers**, who did not ask to be graded: they meet Sealmark through a results page, a GitHub issue from `sealmark-bot`, a private disclosure, or a grade-change email, and they can reply, ask for a re-test or a correction, or ask to be removed.
- **Coding agents and AI assistants**: the hero has an "agent" tab with a prompt to paste into a coding agent (`web/lib/agent-prompt.ts`), and the site serves `llms.txt` / `llms-full.txt` and JSON-LD (`web/lib/seo.ts`).

## Product Purpose

Sealmark is an open-source (Apache-2.0) behavioral conformance test harness for MCP servers. It starts a server, calls its tools with fixed inputs (no language model in the loop), checks what actually happened (database state over its own connection, file diffs, listener hits, the process table) and prints a letter grade per test area with the evidence behind every check. sealmark.dev carries the docs, the methodology, and the public results for real MCP servers, which a fleet re-tests every 6 hours.

Why it exists (decisions D5 to D7, 2026-10-08): verification gets scarcer as generation gets cheaper, and a public, reproducible scorecard justifies a website, builds Jordan's reputation, and is hard for a platform to absorb. Revenue is secondary (`business.md`).

Success: the north star, first written by Maya on 2026-11-05 and matching Jordan's builders-first answer (2026-11-14), is "become the trusted conformance check MCP server authors run and cite": more servers graded and current, maintainers acting on their grades, more installs, and a site that always matches the CLI on npm. "A grade is only worth something if it is right: correctness beats volume." Hannah's metrics: servers graded, share graded within 10 days, npm weekly downloads, owner replies to notices (counts only). The founding kill criterion: within 90 days of publishing, no maintainer engages and no one cites the methodology.

## Positioning

Sealmark grades what a server **does**, not what it **declares** (D7). It runs the server in a world the harness owns, calls its tools, and decides from side effects, not from the reply, the schema, the source or a model's reading of them: "A server that says 'rejected' and still writes the row fails." No model is in the loop, so the same server version and configuration give the same verdicts anywhere, and a maintainer can reproduce any line of evidence.

Against neighbours (from `/compare/`): the MCP project's Inspector explores a server interactively and its conformance framework checks protocol compliance; scanners such as Snyk's agent scan and Cisco's mcp-scanner decide from descriptions, source or an LLM judge; eval platforms score how real models use the tools. Sealmark complements the official tools, does not replace them, and is not run by the MCP project. The compare page also states where Sealmark is weaker; keep that.

## Operating Context

- **CLI**: `npx sealmark init` (imports servers from MCP clients or writes `sealmark.yaml`), `doctor`, `run`; Node 22.13+, no Docker, no account. Reports in text, JSON, JUnit, SARIF, badge and shields formats; exit codes for CI; a composite GitHub Action (`sealmark/action/`) that uploads SARIF. npm package `sealmark`, currently 1.0.1.
- **Site** (`web/`): home, `/docs/` (concepts, guides, reference, methodology, roadmap, changelog, safety, troubleshooting), `/results/` with one page per server plus `/results/history/`, `/compare/`, `/mcp-conformance-testing/`, `/disclosure/`, `/notify/`, `/privacy/`, badge files at `/badge/`.
- **Fleet** (`fleet/`, `.github/workflows/fleet.yml`): every 6 hours it picks servers to re-test (new versions, stale results, a few new ones from the MCP Registry), merges the reports into `web/content/data/server-results.json` and `fleet/history.jsonl`, commits and deploys. `release-sync.yml` follows each CLI release: pins it, regenerates the docs, deploys and checks the live site.
- **Owner notices**: grade-change email alerts (double opt-in, on, from `grades@notify.sealmark.dev`); one GitHub issue per repository from `sealmark-bot` on a first grade, never naming a security finding (first batches chosen by hand in `fleet/owner-pick.json`; `OWNER_ISSUES_LIVE` not set yet); owner replies collected in `fleet/owner-weekly.md`.
- **Disclosure**: security findings go privately to the maintainer first (14 days to reply, one reminder, publication at a fix or day 90). Until then the results page keeps the grade but hides the evidence, tools and start command (`web/content/data/disclosure.json`, `web/lib/disclosure.mjs`). Contact `disclosure@sealmark.dev`.
- **Who works on it**: Hannah Voss (`hq-sealmark`, a Trinity agent on ax1) owns the CLI, site and fleet end to end through `hannah/*` PRs, reporting to Maya (`hq-builder`). High-risk changes (money, monetization, security/settings, public releases and Sealmark results, direction) need Jordan's yes. Jordan's PC checkouts are often behind GitHub; read `origin/main`.

## Capabilities and Constraints

- **Test areas**: `core` on any server (protocol and schemas, tool-poisoning indicators, malformed-input survival, secret echo; hygiene only); deeper packs when the harness can give the server a target it owns: `db`/`sqlite`, `fs`, `git`, `net`, `http`, `effects`, opt-in `exec`, `custom` and plugins; `scope`, `sql-guard`, `upstream` are candidate packs, outside the standard profile and the badge. The check list and grading formula are defined once in the CLI (`cli/src/grade.ts`, mirrored by `web/lib/data.ts`) and in the methodology; do not restate them elsewhere.
- **Terminology**: the site says "test area" / "test suite" and labels packs Protocol, Database, SQLite, Files, Git, Network, HTTP, Effects, Commands, Custom (`web/lib/results-shared.ts`); the CLI says "pack". Verdicts: pass, partial, fail, inconclusive, n/a. Also STANDARD vs CUSTOM run, provisional grade (`A*`), hygiene only, held / under private disclosure, candidate, planned. A server's grade is its lowest test-area grade.
- **Versions**: CLI 1.0.1; methodology `0.3-draft` (checks and thresholds can still change before methodology 1.0).
- **Stack constraints**: Next.js 16.4 App Router with `output: "export"` (static HTML, so no PPR or cacheComponents), served as Cloudflare Workers static assets; the Worker handles only `/api/*` (notify, visits) with D1 `sealmark-notify`. Shared venture-site components: `skullet` for every loading state, `nextjs-toploader`, `clsx`. UI state rules in `web/AGENTS.md` (one `data-state` per flow, `PlayPause` on anything that moves).
- **Single sources**: results come only from `server-results.json`; counts on the site are computed from it, never typed. Docs reference pages are generated from the pinned CLI (`npm run docs:gen`); author and contact live in `web/lib/site.ts`; every sentence in `web/lib/seo.ts` is a product claim checked against the CLI.
- **Build gates**: `scripts/home-check.mjs` (home body copy under a word ceiling, about 230 hand-budgeted words; no "beta"/"preview"/"early preview"/"concept"/"mock"; the honesty items present; anything unbuilt labelled "planned"), `scripts/budget.mjs` (per-page weight ceilings, a ratchet), `docs-check`, `schema:check`, `version:check`.
- **Privacy**: page-view counting only (page, time, referring host, UTM); no cookies, no IP, no third-party analytics or ads; GPC/DNT honoured. CLI telemetry off unless `SEALMARK_TELEMETRY=1`.
- **Not done, by design**: no model in the loop, so prompt injection carried in tool output is out of scope; no source, dependency or supply-chain checks; no interactive UI; no machine-wide scan.
- **Open decisions** (not to be decided by design work):
  - Methodology 1.0: Jordan said yes, now (2026-11-13, resent by Telegram 2026-11-14); the `hannah/methodology-1-0` branch in the CLI repo was not merged as of 2026-11-14.
  - D25: which mutating-SQL cases are core (grades show `critical part: <id>` until decided).
  - Owner GitHub issues: drafts first, then a hand-approved batch; going automatic (`OWNER_ISSUES_LIVE`) waits on Jordan's "go live".
  - Held security findings: Jordan decided the repo owner is emailed privately (2026-11-14). Hannah's branch `hannah/private-owner-notices` was not merged as of 2026-11-14; the first batch goes to Jordan as drafts.
  - Paid plans, decided for now (Jordan, 2026-11-14): free and open source only, with no paid mention on the site. The placeholder tiers in `business.md` stay internal.
  - A hosted badge service, DuckDB, MySQL and Marketplace listing of the Action are "planned" on the roadmap, not built.

## Brand Commitments

- **Name and domain**: Sealmark (D8: a positive mark maintainers want to display, works as a badge, "Sealmark A"); sealmark.dev (D9).
- **Logo**: the mark is defined in `web/lib/logo.json` and drawn by `web/components/Logo.tsx` / `web/app/icon.svg`; sealmark-site is its source of truth, and `sealmark/assets/` holds unchanged copies (`sealmark/assets/README.md`).
- **The non-endorsement line** appears on every surface and is build-checked: "An A is not a security endorsement", with grades scoped to the tested version and settings. Footer also: "Not affiliated with any MCP server project."
- **Voice and credit** (Jordan, 2026-11-14): a neutral project voice, "Sealmark" / "we", with Jordan credited as creator in the footer and metadata ("Created by Jordan Allen Lewis", `web/lib/site.ts`). Owner issues come from `sealmark-bot`, never a personal account. Copy that speaks as one person (the compare page's "one maintainer") is out of line with this.
- **Tagline**: "Every row where it belongs." heads the CLI README but appears nowhere on the site. Whether it is binding is an open decision.
- **Independence pledge** (D10, `business.md`): never paywall a check; public grades come only from the public run, with the same formula for everyone; paying customers get no early notice, softer rubric or say over published grades.
- No brand or voice document exists in either repo. The copy rules that do exist are the build checks above and the "keep it true and keep it plain" rule in `web/lib/seo.ts`.

## Evidence on Hand

- **Real results**: `web/content/data/server-results.json`, 213 server entries at origin/main 04e850e (2026-11-14), methodology 0.3-draft. The count changes every 6 hours; always read it from the file. History in `fleet/history.jsonl`, trends in `web/content/data/trends.json`.
- **Verification of Sealmark itself**: the `verification` block of the same file: two rounds in which every verdict on 30 servers was checked independently (source reading and direct calls), including deliberately broken test servers; shown on `/results/`.
- **Method and design docs**: `sealmark/docs/methodology.md` (every check, its probes and known blind spots), `sealmark/docs/architecture.md`, `sealmark/CHANGELOG.md`, the site's `/compare/` page.
- **Assets**: logo, favicon, apple icon, OG/Twitter cards with alt text (`web/app/`), the GitHub social preview (`sealmark/assets/social-preview.png`), the hero `Mechanism` diagram and other figures in `web/components/visuals/`.
- **Live counters**: npm weekly downloads (README badge), visit counts behind `/api/visits` (owner token only).
- **Absent, do not fabricate**: no testimonials, quotes, customers, partners, press or endorsements; no maintainer replies yet (`fleet/owner-notified.json` records no issues, emails or replies); no pricing; no user or install numbers beyond what npm reports; no certification or standards mapping (the persona review flagged such claims as damaging).

## Product Principles

1. **Behavior over declaration.** Decide from what a call did, observed at the source, never from what the server, its schema or a model says.
2. **A grade must be right before it is anywhere.** Correctness beats volume; a grade that rests on nothing is not shown, and nothing scored means no grade, never an invented one.
3. **Honest labels over big numbers.** Every grade is scoped to a version and configuration, says what was not covered, and marks provisional, CUSTOM, hygiene-only, held and planned plainly.
4. **Fair to the people graded.** Maintainers hear first and privately, can reply, get re-tested, corrected or removed, and the formula is the same for everyone.
5. **Simple for a normal engineer, free for everyone.** One command, no account, every check open; errors say what to type next.

## Accessibility & Inclusion

Existing commitments in code: anything that moves on its own has a pause control (WCAG 2.2.2, `components/PlayPause.tsx`); reduced motion is honoured site-wide; form-control borders meet 3:1 (WCAG 1.4.11); loading and results use `aria-busy` and a `role="status"` region (`web/AGENTS.md`). Target standard: WCAG 2.2 AA (Jordan, 2026-11-14).
