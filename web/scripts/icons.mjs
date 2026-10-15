// node scripts/icons.mjs
//
// Regenerates the site icons from lib/logo.json (the same file the on-page logo draws from) so every icon
// matches the logo on the page exactly. Writes app/icon.svg, app/apple-icon.png and app/favicon.ico.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { L, logoSvg } from "./logo-svg.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(resolve(web, "app", "icon.svg"), logoSvg(32) + "\n");
console.log("icons: wrote app/icon.svg");

await sharp({ create: { width: 180, height: 180, channels: 4, background: L.colors.background } })
  .composite([{ input: Buffer.from(logoSvg(152)), top: 14, left: 14 }])
  .png()
  .toFile(resolve(web, "app", "apple-icon.png"));
console.log("icons: wrote app/apple-icon.png");

const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((n) => sharp(Buffer.from(logoSvg(n))).png().toBuffer()));
const ico = Buffer.alloc(6 + 16 * sizes.length);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
sizes.forEach((n, i) => {
  const e = 6 + 16 * i; // entry: width, height, then colour and reserved bytes stay 0 from alloc
  ico.writeUInt8(n, e);
  ico.writeUInt8(n, e + 1);
  ico.writeUInt16LE(1, e + 4);
  ico.writeUInt16LE(32, e + 6);
  ico.writeUInt32LE(pngs[i].length, e + 8);
  ico.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(resolve(web, "app", "favicon.ico"), Buffer.concat([ico, ...pngs]));
console.log("icons: wrote app/favicon.ico");
