// node --test lib/   (npm test in web/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeCardSvg, badgeFiles, badgeSnippets, badgeSvg, clip, shieldsDoc } from "./badge.mjs";

test("shields document has exactly the four endpoint keys and the CLI's colour names", () => {
  const d = shieldsDoc("sealmark", "protocol A · network D", "D");
  assert.deepEqual(Object.keys(d), ["schemaVersion", "label", "message", "color"]);
  assert.deepEqual(d, { schemaVersion: 1, label: "sealmark", message: "protocol A · network D", color: "orange" });
  assert.equal(shieldsDoc("sealmark", "x", "A").color, "brightgreen");
  assert.equal(shieldsDoc("sealmark", "x", "F").color, "red");
});

test("snippets link the image to the results page in markdown, html and rst", () => {
  const s = badgeSnippets("pg-mcp");
  assert.equal(s.badge.markdown, "[![Sealmark](https://sealmark.dev/badge/pg-mcp.svg)](https://sealmark.dev/results/pg-mcp/)");
  assert.equal(s.badge.html, '<a href="https://sealmark.dev/results/pg-mcp/"><img src="https://sealmark.dev/badge/pg-mcp.svg" alt="Sealmark"></a>');
  assert.equal(s.badge.rst, ".. image:: https://sealmark.dev/badge/pg-mcp.svg\n   :target: https://sealmark.dev/results/pg-mcp/\n   :alt: Sealmark");
  assert.equal(s.card.markdown, "[![Sealmark](https://sealmark.dev/badge/pg-mcp-card.svg)](https://sealmark.dev/results/pg-mcp/)");
  assert.equal(s.urls.shields, "https://img.shields.io/endpoint?url=https%3A%2F%2Fsealmark.dev%2Fbadge%2Fpg-mcp.json");
  assert.ok(s.shields.markdown.startsWith("[![Sealmark](https://img.shields.io/endpoint?url="));
});

test("flat badge keeps its text and escapes markup", () => {
  const svg = badgeSvg("sealmark", "protocol A · files <B>", "B", "includes a finding under private disclosure");
  assert.match(svg, /<title>sealmark: protocol A · files &lt;B&gt; \(includes a finding under private disclosure\)<\/title>/);
  assert.ok(!svg.includes("<B>"));
  assert.match(svg, /fill="#4c9f38"/);
});

test("card shows the server grade, clips long text and keeps the full text in its title", () => {
  const name = "an-extremely-long-server-name-that-will-not-fit-on-the-card";
  const svg = badgeCardSvg({ name, version: "1.2.3", testedAt: "2026-11-15", message: "protocol A · network D", letter: "D", note: null });
  assert.match(svg, />D<\/text>/);
  assert.match(svg, /fill="#d9822b"/);
  assert.ok(svg.includes(`<title>sealmark: ${name} 1.2.3, grade D: protocol A · network D, tested 2026-11-15</title>`));
  assert.ok(svg.includes(`>${clip(name, 30)}</text>`));
  assert.ok(clip(name, 30).endsWith("…") && clip(name, 30).length === 30);
  assert.equal(clip("short", 36), "short");
  assert.match(svg, /<g clip-path="url\(#t\)"/);
});

test("card escapes server-supplied text", () => {
  const svg = badgeCardSvg({ name: 'x"><script>', version: "1&2", testedAt: "2026-11-15", message: "protocol A", letter: "A", note: null });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("x&quot;&gt;&lt;script&gt;"));
  assert.ok(svg.includes("1&amp;2"));
});

test("badge files: three per server, and a name clash stops the build", () => {
  assert.deepEqual(badgeFiles(["a"]).map((f) => f.file), ["a.svg", "a-card.svg", "a.json"]);
  assert.throws(() => badgeFiles(["x", "x-card"]), /x-card\.svg would serve two servers/);
});

test("no letter (a withdrawn grade) draws a neutral grey badge, card and shields doc, never a failing colour", () => {
  assert.deepEqual(shieldsDoc("sealmark", "no current grade", null), { schemaVersion: 1, label: "sealmark", message: "no current grade", color: "lightgrey" });
  const svg = badgeSvg("sealmark", "no current grade", null, null);
  assert.match(svg, /#6b7280/);
  assert.doesNotMatch(svg, /#d73a49/);
  const card = badgeCardSvg({ name: "x", version: "1.0", testedAt: "2026-11-09", message: "no current grade", letter: null, note: null });
  assert.doesNotMatch(card, /#d73a49|>F</);
  assert.doesNotMatch(card, /grade null/);
});
