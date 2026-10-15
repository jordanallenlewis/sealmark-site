import geometry from "./logo.json";

// The one Sealmark logo. The nav, footer, docs header, 404 page and the home diagram draw it through Logo;
// scripts/icons.mjs draws icon.svg, favicon.ico, apple-icon.png and the social cards from the same file.
export const LOGO = geometry;
// The ring is exactly LOGO.ring.dashes even dashes: the gap is what is left of the circumference.
export const RING_GAP = (2 * Math.PI * LOGO.ring.r) / LOGO.ring.dashes - LOGO.ring.dash;
