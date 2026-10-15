// Shared Sealmark logo builder. Reads lib/logo.json -- the same file the on-page logo draws from -- and exports
// L (the parsed logo data) and logoSvg(px) (the SVG markup of the logo at a given pixel size).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const L = JSON.parse(readFileSync(resolve(web, "lib", "logo.json"), "utf8"));
const gap = (2 * Math.PI * L.ring.r) / L.ring.dashes - L.ring.dash;

export function logoSvg(px) {
  const c = L.center;
  const rows = L.rows.ys
    .map(
      (y, i) =>
        `  <line x1="${L.rows.x1}" y1="${y}" x2="${L.rows.x2}" y2="${y}" stroke="${L.colors.ink}" stroke-width="${L.rows.width}" stroke-linecap="round"${i === L.rows.dimIndex ? ` opacity="${L.rows.dimOpacity}"` : ""}/>`
    )
    .join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.viewBox} ${L.viewBox}" width="${px}" height="${px}">\n` +
    `  <circle cx="${c}" cy="${c}" r="${L.ring.r}" fill="none" stroke="${L.colors.accent}" stroke-width="${L.ring.width}" stroke-dasharray="${L.ring.dash} ${gap}" transform="rotate(-90 ${c} ${c})"/>\n` +
    `  <circle cx="${c}" cy="${c}" r="${L.disc.r}" fill="${L.colors.accent}"/>\n` +
    rows +
    `\n</svg>`
  );
}
