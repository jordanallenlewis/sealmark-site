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

## UI libraries

Decided 2026-11-18. The site is hand-written CSS Modules on `globals.css` tokens (55 KB of CSS in total), with no Tailwind and no component library.

**No Tailwind.** It would add a PostCSS build step and a reset that can shift the existing look, and it would buy nothing here: the unstyled primitives below are styled with CSS Modules. The shadcn CLI and the registries built on it (Magic UI, Aceternity, 21st.dev) emit Tailwind class names, so they are out too: copy an idea from them, never their source or their default look. Revisit only if a needed component cannot be written in CSS Modules in a reasonable time.

**Adopt a library only when a component needs it, in the PR that needs it, with no unused dependency.** Every adoption is restyled to the site's tokens, passes the visual check (7 widths including 3840 px, light and dark), CI green, and states the bundle-size change in the PR.

| Need | Library | Today |
|---|---|---|
| Dialog, popover, tooltip, menu, tabs, select | Base UI (`@base-ui/react`, unstyled); Radix only if a component we adopt requires it | Not needed. `components/docs/Drawer.tsx` (76 lines) and `Tabs.tsx` work |
| Toast | Sonner | Not needed. `CopyButton` reports through `data-state` and its own status text |
| Mobile bottom drawer | Vaul | Not needed. The docs drawer is a side panel |
| Command menu | cmdk | Not needed. `docs/Search` (271 lines) is the search; move to cmdk only if it grows into a command menu |
| Animated numbers | NumberFlow | Not needed. Nothing on the site counts up, and a figure that animates must still read right without script |

**Showcase sources** (Magic UI, Aceternity, RareUI, Beautiful UI, 21st.dev) only for a distinctive moment, never where it costs readability or performance. Motion respects `prefers-reduced-motion` and anything that moves on its own gets `PlayPause` (see UI state). The non-endorsement line and the honest-label rules in `PRODUCT.md` win over any visual idea.
