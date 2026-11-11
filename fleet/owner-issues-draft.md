# Owner issues: drafts

Written by `fleet/notify-owners.mjs` on 2026-11-11. Not filed: the OWNER_ISSUES_TOKEN secret is not set. These are the issues the next live run would open (at most 8 per run); 157 more repositories wait for later runs.

---

## cyanheads/filesystem-mcp-server

**Title:** Sealmark graded @cyanheads/filesystem-mcp-server 1.0.4: F

<!-- sealmark-owner-notice:cyanheads-fs -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `@cyanheads/filesystem-mcp-server` 1.0.4 with its default settings on 2026-10-13 and graded it **F**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | A | 4/4 |
| Files | F | 1.5/4 |

Checks that failed:

- `fs-link-escape` Links cannot lead out of the allowed root: a link inside the root led to a file outside it: read_file via link-dir; read_file via link-file; list_files via link-dir; write_file write via link-dir-write
- `fs-size-cap` Large file reads are capped: read_file: the connection dropped or the call timed out (the response was too large for the transport)

Full results, with what was and was not covered: https://sealmark.dev/results/cyanheads-fs/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

Badge, if you want one (it links to the results and updates with each re-test):

```md
[![Sealmark](https://sealmark.dev/badge/cyanheads-fs.svg)](https://sealmark.dev/results/cyanheads-fs/)
```

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## 3DStreet/3dstreet-mcp

**Title:** Sealmark graded 3dstreet-mcp 0.2.3: B

<!-- sealmark-owner-notice:3dstreet-mcp -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `3dstreet-mcp` 0.2.3 with its default settings on 2026-11-09 and graded it **B**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | B | 1.5/2 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/3dstreet-mcp/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## achromat-ai/achromat-mcp-server

**Title:** Sealmark graded @achromat-ai/mcp-server 0.1.4: A

<!-- sealmark-owner-notice:achromat-ai-mcp-server -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `@achromat-ai/mcp-server` 0.1.4 with its default settings on 2026-11-09 and graded it **A**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | A | 4/4 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/achromat-ai-mcp-server/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## RantumBits/addressintel-mcp

**Title:** Sealmark graded addressintel-mcp 1.1.2: A

<!-- sealmark-owner-notice:addressintel-mcp -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `addressintel-mcp` 1.1.2 with its default settings on 2026-11-09 and graded it **A**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | A | 4/4 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/addressintel-mcp/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## bobberrisford/affiliatemcp

**Title:** Sealmark graded affiliate-networks-mcp 0.20.0: A

<!-- sealmark-owner-notice:affiliate-networks-mcp -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `affiliate-networks-mcp` 0.20.0 with its default settings on 2026-11-09 and graded it **A**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | A | 4/4 |
| Effects | A | 1/1 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/affiliate-networks-mcp/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

Badge, if you want one (it links to the results and updates with each re-test):

```md
[![Sealmark](https://sealmark.dev/badge/affiliate-networks-mcp.svg)](https://sealmark.dev/results/affiliate-networks-mcp/)
```

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## agent-bev/bev-door

**Title:** Sealmark graded @agent-bev/mcp-server 0.2.6: B

<!-- sealmark-owner-notice:agent-bev-mcp-server -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `@agent-bev/mcp-server` 0.2.6 with its default settings on 2026-11-09 and graded it **B**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | B | 3.5/4 |
| Effects | A | 2/2 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/agent-bev-mcp-server/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

Badge, if you want one (it links to the results and updates with each re-test):

```md
[![Sealmark](https://sealmark.dev/badge/agent-bev-mcp-server.svg)](https://sealmark.dev/results/agent-bev-mcp-server/)
```

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## AminForou/mcp-gsc

**Title:** Sealmark graded AminForou/mcp-gsc 0.3.1: A

<!-- sealmark-owner-notice:aminforou-mcp-gsc -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `AminForou/mcp-gsc` 0.3.1 with its default settings on 2026-11-09 and graded it **A**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | A | 4/4 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/aminforou-mcp-gsc/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## antvis/mcp-server-chart

**Title:** Sealmark graded antvis/mcp-server-chart 0.9.10: B

<!-- sealmark-owner-notice:antvis-mcp-server-chart -->

Hi! [Sealmark](https://sealmark.dev) is an open-source behavioural test suite for MCP servers. It started `antvis/mcp-server-chart` 0.9.10 with its default settings on 2026-11-09 and graded it **B**.

| Pack | Grade | Points |
|---|---|---|
| Protocol | B | 3.5/4 |

No check failed outright.

Full results, with what was and was not covered: https://sealmark.dev/results/antvis-mcp-server-chart/

This is an automated re-test, not a review by hand, and Sealmark can be wrong. If a verdict looks wrong, reply here or email disclosure@sealmark.dev and we recheck it.

The fleet re-tests new versions every 6 hours. To get an email when this grade changes, use the form on the results page. This is the only issue Sealmark opens on this repository; close it whenever you like, and reply "opt out" if you do not want it to post here again.

---

## Skipped

- `postgres-mcp`: no GitHub repository found
- `aetherwealth-mcp`: no GitHub repository found
- `airbnb`: no GitHub repository found
- `anyforge-mcp-server`: no GitHub repository found
- `apillow-mcp`: no GitHub repository found
- `atmy-mcp`: no GitHub repository found
- `backtest-auditor`: no GitHub repository found
- `callmcp-server`: no GitHub repository found
- `clarxai-mcp`: no GitHub repository found
- `demomagic-mcp`: no GitHub repository found
- `doc-cheap-mcp`: no GitHub repository found
- `fetch-mcp`: no GitHub repository found
- `git-mcp-py`: no GitHub repository found
- `kawacode-mcp`: no GitHub repository found
- `korala-mcp`: no GitHub repository found
- `lovie`: no GitHub repository found
- `mafdet-mcp`: no GitHub repository found
- `mainbook-mcp`: no GitHub repository found
- `maxwellintl-x402-mcp`: no GitHub repository found
- `meetlark-mcp-server`: no GitHub repository found
- `motherduck`: no GitHub repository found
- `operandi-mcp`: no GitHub repository found
- `percher-mcp`: no GitHub repository found
- `pretrip-mcp`: no GitHub repository found
- `rlabs-cl-arketum`: no GitHub repository found
- `smartmemory-mcp`: no GitHub repository found
- `sqlite`: no GitHub repository found
- `text-editor`: no GitHub repository found
- `vertical-marketplace-mcp`: no GitHub repository found
- `gency-ai-gency-mcp`: no GitHub repository found
- `agent-infra-fs` (bytedance/UI-TARS-desktop): archived
- `reddit-research-mcp` (jordanallenlewis/reddit-research-mcp): our own repository
