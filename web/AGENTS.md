<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI state

One discriminated-union status per flow, never parallel booleans. Put it on the component root as `data-state="<phase>"` so tests, agents and CSS read one attribute. Set `aria-busy` while loading, announce results through a `role="status"` region that is never inside a hidden container, and clear every timer, listener and fetch on unmount. Anything that moves on its own gets the shared `PlayPause` button (`components/PlayPause.tsx`, label swap, no `aria-pressed`).

| Component | `data-state` values |
|---|---|
| `visuals/Mechanism`, `visuals/Pipeline` (via `useAutoplay`) | `playing` · `paused-user` (pause button or a dot click; stays until play) · `paused-auto` (offscreen, reduced motion, `auto={false}`) |
| `home/TickerControl` (results ticker) | `playing` · `paused` |
| `CopyButton` | `idle` · `copied` · `selected` (clipboard refused, code selected) · `failed` |
| `docs/Search` | `idle` · `loading` · `ready` · `error` (Retry, or focus again) |
