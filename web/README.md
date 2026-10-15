# Sealmark site

Static marketing site for Sealmark (behavioral conformance tests for MCP servers). Next.js App Router, exported to plain HTML.

```bash
npm run dev        # http://localhost:3000
npm run build      # static export to ./out
npm run lint && npx tsc --noEmit
```

- Example data (Servers A-E, all invented) and the grading function live in `lib/data.ts`. `gradePack` mirrors the formula in `docs/mvp-design.md` (the methodology version is read from the CLI by `npm run docs:gen`).
- Hosting: `wrangler.jsonc` serves `./out` as Cloudflare Workers static assets. `npm run deploy:preview` only prints instructions; deploy by hand with `npx wrangler login` then `npx wrangler deploy`.
- `output: "export"` rules out `cacheComponents` and `partialPrefetching` (Next 16.4 fails with "PPR cannot be enabled in export mode"), so they are off.
