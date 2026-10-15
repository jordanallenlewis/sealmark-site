// node scripts/social-card.mjs
//
// Renders the 1200x630 social card with headless Chrome and writes app/opengraph-image.png plus an identical
// app/twitter-image.png. The logo comes from lib/logo.json via scripts/logo-svg.mjs. Set CHROME to a custom binary.
import { existsSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { L, logoSvg } from "./logo-svg.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chrome = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error("social-card: no Chrome found; set CHROME to the path of a Chrome or Chromium binary");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "sealmark-card-"));

const circles = [
  ["A", "#2a9d5c", "#ffffff"],
  ["B", "#4d8f2e", "#ffffff"],
  ["C", "#d6a000", "#1a1400"],
  ["D", "#e0742a", "#1f0e00"],
  ["F", "#c8432f", "#ffffff"],
]
  .map(
    ([g, bg, fg]) =>
      `<div style="box-sizing:border-box; width:62px; height:62px; border:3px solid #111214; border-radius:50%; display:flex; align-items:center; justify-content:center; font:800 26px 'Bricolage Grotesque',sans-serif; background:${bg}; color:${fg};">${g}</div>`
  )
  .join("");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=IBM+Plex+Mono:wght@400&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body { background: ${L.colors.background}; overflow: hidden; }
</style>
</head>
<body>
  <div style="position:absolute; left:68px; top:52px; display:flex; align-items:center; gap:14px;">
    ${logoSvg(48)}
    <div style="font:800 34px 'Bricolage Grotesque',sans-serif; color:#f5f2ea; white-space:nowrap;">Sealmark</div>
  </div>
  <div style="position:absolute; left:68px; top:200px; font:800 92px/1.0 'Bricolage Grotesque',sans-serif; letter-spacing:-0.03em;">
    <div style="color:#f5f2ea;">See what your</div>
    <div style="color:#f5f2ea;">MCP server</div>
    <div style="color:${L.colors.accent};">actually does.</div>
  </div>
  <div style="position:absolute; left:70px; top:500px; font:400 24px/1.5 'IBM Plex Mono',monospace;">
    <div style="color:#f5f2ea;">Behavioral conformance tests for MCP servers.</div>
    <div style="font-size:20px; color:#a29d92;">No LLM in the loop. Every grade comes with its evidence.</div>
    <div style="color:${L.colors.accent};">sealmark.dev</div>
  </div>
  <div style="position:absolute; right:80px; top:110px;">${logoSvg(340)}</div>
  <div style="position:absolute; right:80px; bottom:50px; display:flex; gap:6px;">${circles}</div>
</body>
</html>`;

const htmlPath = join(dir, "card.html");
writeFileSync(htmlPath, html);
const outPath = resolve(web, "app", "opengraph-image.png");

execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  "--virtual-time-budget=8000",
  "--user-data-dir=" + join(dir, "profile"),
  "--screenshot=" + outPath,
  pathToFileURL(htmlPath).href,
]);

copyFileSync(outPath, resolve(web, "app", "twitter-image.png"));
rmSync(dir, { recursive: true, force: true });
console.log("social-card: wrote app/opengraph-image.png and app/twitter-image.png");
