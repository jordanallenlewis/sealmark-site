import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// Fully static site: `next build` writes ./out, which wrangler.jsonc serves as Workers static assets.
// cacheComponents and partialPrefetching were removed: Next 16.4 fails the export with
// "Invariant: PPR cannot be enabled in export mode", and a static page has nothing to cache anyway.
// trailingSlash makes every route emit <route>/index.html, which matches wrangler's "auto-trailing-slash".
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  // 'graph' keeps the docs shell stylesheet off the marketing pages: with the default merge strategy Turbopack folded
  // docs.module.css (56 KB) into the CSS chunk the home page loads. See scripts/build.mjs for the enforced budget.
  experimental: { cssChunking: "graph" },
};

// Plugins are passed by package name (strings) because Turbopack cannot take JS functions.
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: [
      "rehype-slug",
      ["rehype-autolink-headings", { behavior: "append", properties: { className: ["anchor"], ariaLabel: "Link to this section" }, content: { type: "text", value: "#" } }],
    ],
  },
});

export default withMDX(nextConfig);
