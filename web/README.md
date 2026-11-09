# Sealmark site

Static marketing site for Sealmark (behavioral conformance tests for MCP servers). Next.js App Router, exported to plain HTML.

```bash
npm run dev        # http://localhost:3000
npm run build      # static export to ./out
npm run lint && npx tsc --noEmit
```

- The grading formula and check list live in `lib/data.ts` (`gradePack` mirrors `cli/src/grade.ts` in the sealmark repository; the methodology version is read from the CLI by `npm run docs:gen`). Real results live in `lib/results.ts`, read from `content/data/server-results.json`.
- Shared components, the same as the other venture sites: `skullet` (every loading state), `nextjs-toploader` (route progress bar, `components/TopLoader.tsx`) and `clsx` (class names).
- Hosting: `wrangler.jsonc` serves `./out` as Cloudflare Workers static assets. `npm run deploy:preview` only prints instructions; deploy by hand with `npx wrangler login` then `npx wrangler deploy`.
- `output: "export"` rules out `cacheComponents` and `partialPrefetching` (Next 16.4 fails with "PPR cannot be enabled in export mode"), so they are off.
