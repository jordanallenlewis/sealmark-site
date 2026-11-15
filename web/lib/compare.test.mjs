// node --test lib/   (npm test in web/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OTHER_GRADERS, GLAMA, compareText } from "./compare.mjs";

const https = (u) => /^https:\/\/[^\s]+$/.test(u);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

test("every other grader names what it checks and links its own source", () => {
  assert.ok(OTHER_GRADERS.length >= 4);
  for (const g of OTHER_GRADERS) {
    assert.ok(g.name && g.what, `${g.name}: name and what are required`);
    assert.ok(https(g.url), `${g.name}: source must be an https link, got ${g.url}`);
    assert.match(g.checked, DATE, `${g.name}: checked date`);
  }
});

test("every Glama row has both sides and a first-party source", () => {
  assert.match(GLAMA.checked, DATE);
  assert.ok(GLAMA.rows.length >= 5);
  for (const r of GLAMA.rows) {
    assert.ok(r.aspect && r.sealmark && r.glama, `row ${r.aspect}: all three cells are required`);
    assert.ok(r.sources.length > 0, `row ${r.aspect}: needs a source`);
    for (const u of r.sources) assert.match(u, /^https:\/\/(glama\.ai|tdqs\.dev)\//, `row ${r.aspect}: claims about Glama cite Glama's own pages`);
  }
  for (const u of GLAMA.stronger.flatMap((x) => x.sources)) assert.match(u, /^https:\/\/(glama\.ai|tdqs\.dev)\//);
});

test("compare copy speaks in the project voice, not as one person", () => {
  const text = compareText();
  assert.doesNotMatch(text, /\bone maintainer\b|\bthe maintainer\b|\bI\b|\bmy\b/i);
  assert.doesNotMatch(text, /—/, "no em dashes");
});

test("the site's CLI version comes from the pinned package, never a typed literal", () => {
  const seo = readFileSync(new URL("./seo.ts", import.meta.url), "utf8");
  assert.doesNotMatch(seo, /CLI_VERSION\s*=\s*["'`]\d/, "CLI_VERSION must be read from package.json devDependencies.sealmark");
  const page = readFileSync(new URL("../app/compare/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /version \d+\.\d+\.\d+/, "the compare page must not type a version");
});
