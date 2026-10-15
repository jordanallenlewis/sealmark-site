// The prompt people paste into a coding agent. One copy: the home page (components/Hero.tsx) and the docs quickstart both use it.
export const AGENT_PROMPT =
  "Run npx sealmark init in this repo and point sealmark.yaml at our MCP server. Then run npx sealmark run. For every check that is not a pass, open the evidence, explain the cause, and propose a fix. Do not weaken the checks or lower the gate.";
