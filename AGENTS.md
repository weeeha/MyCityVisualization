<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MyCityVisualization

Multi-layer city data map: deck.gl layers rendered over a MapLibre basemap. One city so far
(Montreal), one data layer (air quality, from RSQA IQA station readings).

## Commands

```bash
npm run dev          # next dev --turbopack
npm run build
npm run lint         # eslint
npm test             # vitest run
npm run e2e          # playwright (cross-browser)
```

Before claiming a change done: `npm run lint && npm test`. Map rendering is not covered by
unit tests — if you changed anything visual, run `npm run e2e` or open the map and look.

## Architecture — the layer contract

`src/layers/registry.ts` is **the only file in the codebase that imports a specific layer**.
Adding a layer = one import plus one array entry; nothing else changes. Keep it that way.

Every layer is a manifest (`src/layers/types.ts`) and `registry.test.ts` enforces the shape:

- `id`, `label`, `description` — non-empty strings
- `render()` — returns deck.gl layers
- `Legend` — a component, always present
- `budget.mobile` — one of `full` | `reduced` | `off`
- optional `refresh` — `staleAfterMs` **must** be greater than `intervalMs`

Rules that follow:

- **Layers never import each other.** Isolation is asserted by tests and the E2E spec; a
  cross-layer import is the one change that breaks the whole premise.
- A layer owns its own `schema` / `normalise` / `fetchPayload` / `render` / `Legend`, all
  under `src/layers/<id>/`. Follow `air/` as the reference implementation.
- `src/cities/<city>.ts` holds `CityConfig`. **`center` is `[lng, lat]`** — deck/MapLibre
  order, not the `[lat, lng]` most APIs return. This is the easiest bug to introduce here.
- The app **owns the 3D building extrusion layer** (since 2026-08-08) rather than inheriting
  it from the basemap style, and the basemap is dark. Both were deliberate — don't revert to
  a style-provided extrusion.

## Layout

```
src/layers/     registry + per-layer folders (air/ is the reference)
src/map/        MapCanvas, basemap config
src/shell/      Shell, LayerToggles, useLayersData, useUrlState
src/cities/     CityConfig per city
e2e/            playwright specs      fixtures/  CSV test data
docs/superpowers/  design spec + build plan (2026-08-07)
```

## Gotchas

- **`.vercelignore` is load-bearing.** Vercel does not read `.gitignore` when uploading a
  deployment; without this file the CLI tries to upload `data/` (a ~2.8 GB local GML dataset)
  and the request is rejected as too large. Never delete it, and add any new large local
  directory to it.
- `data/` is the local dataset — never part of a deployment, never committed.
- URL state lives in `useUrlState` — layer selection is shareable by link, so changing the
  param format breaks existing links.
- Never push to `main` — branch per task, PR.
