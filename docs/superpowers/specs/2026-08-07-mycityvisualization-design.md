# MyCityVisualization — Design

**Date:** 2026-08-07
**Status:** Approved design, ready for implementation planning
**Repo:** `weeeha/MyCityVisualization`

---

## 1. What this is

A 3D map of a city with pluggable visualization layers. Montréal is the first and only
city that has to be good; the code is structured so a second city is a config file rather
than a refactor.

It is built as a **platform** (clean layer contract, no city hardcoding) but judged as a
**personal tool** (live data, fast, correct, works on a phone). Where those two pull
against each other, the tool wins.

### Explicit non-goals for v1

- Documentation and fork-ability for other people's cities
- A second city
- Cinematic/portfolio polish as a primary driver
- Depth within any single layer

### Scope assumption

v1 ships **one thin-but-real layer per rendering primitive**, not four finished products.
Real live data, honest legends, both screen sizes — but the air-quality layer is a
choropleth with a colour ramp, not an interpolated forecast. Breadth first, because
breadth is what proves the contract. Depth follows, guided by which layer actually gets
opened.

### Relationship to `weeeha/mymtl`

`mymtl` is a separate, still-live static 2D events map. It is **not** modified or
replaced. This project borrows its 38 curated places as seed content for the places
layer and nothing else.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) on Vercel |
| Basemap | MapLibre GL JS (MIT) |
| Vector tiles | OpenFreeMap **Liberty** — `https://tiles.openfreemap.org/styles/liberty`. Free, no API key, no registration, no request limit |
| Data layers | deck.gl, composited via `MapboxOverlay` in **interleaved** mode |
| Runtime | Node.js (Fluid Compute default). Not Edge — GTFS-RT protobuf decoding needs real Node libs |
| Tests | Vitest (unit), Playwright (E2E, Chromium + WebKit) |

**Why not photorealistic 3D tiles.** Google's Photorealistic 3D Tiles look better but are
an undifferentiated mesh with no per-building attributes, which would make the
buildings-as-data layer impossible. Free-and-queryable beat pretty-and-opaque.

**Why interleaved, not stacked canvases.** Two WebGL contexts mean two cameras to keep in
sync and visible drift on fast pans. Interleaved puts deck's layers inside MapLibre's
render pass — one context, one camera, and correct occlusion (an arc passes *behind* a
tower), which is most of what sells the scene as 3D.

---

## 3. Architecture

```
app/
  layout.tsx
  page.tsx                    renders <Shell/>, nothing else
  api/layers/
    air/route.ts              RSQA CSV  -> normalised JSON, revalidate 300
    transit/route.ts          GTFS-RT   -> normalised JSON, revalidate 20
    places/route.ts           curated JSON,            revalidate 3600
src/
  map/                        engine bridge — knows MapLibre + deck.gl, knows NO layer
    MapCanvas.tsx             MapLibre instance + deck overlay, single canvas
    basemap.ts                dark vector style, building extrusion layer
    camera.ts                 view state, fly-to, pitch/bearing presets
  shell/                      UI chrome — knows the registry, knows NO layer
    Shell.tsx  LayerToggles.tsx  LegendSlot.tsx  DetailCard.tsx
    Timeline.tsx  SettingsPopover.tsx  BottomSheet.tsx
  layers/
    types.ts                  the contract
    registry.ts               the ONLY file importing specific layers
    places/    index.ts fetch.ts render.ts Legend.tsx
    air/       index.ts fetch.ts render.ts Legend.tsx
    buildings/ index.ts render.ts Legend.tsx
    transit/   index.ts fetch.ts render.ts Legend.tsx
  cities/
    montreal.ts               centre, bounds, default camera, enabled layer ids
fixtures/                     captured real API responses — tests + offline dev
```

### The one architectural rule

Nothing in `src/map` or `src/shell` may import from `src/layers/<name>` — only from
`registry.ts` and `types.ts`.

**Acceptance test:** delete any layer's `src/layers/<id>/` folder AND its
`app/api/layers/<id>/` route, remove its line from the registry, and the app still
builds and runs, minus that toggle. A layer owns its full vertical slice, route handler
included — deleting only the `src/layers/<id>/` folder leaves the build broken, since its
route still imports from it. Enforced in CI by an ESLint `no-restricted-imports` rule, so
it fails on push rather than in review.

---

## 4. The layer contract

`src/layers/types.ts`:

```ts
export interface LayerContext {
  city: CityConfig;
  time: TimeState;                    // { now, window: 'now'|'today'|'weekend', cursor? }
  view: ViewState;                    // zoom, pitch, bearing, bounds
  device: 'desktop' | 'mobile';
  options: Record<string, Record<string, unknown>>;   // options[layerId][key]
}

export interface LayerManifest<TData, TFeature> {
  id: string;
  label: string;
  description: string;

  /** Drives client refetch AND the "as of HH:MM" stamp. Single source of truth.
   *  Omitted for layers with no fetch (buildings) — they are never stale. */
  refresh?: { intervalMs: number; staleAfterMs: number };

  /** ALWAYS hits our own /api/layers/*. Never a third party.
   *  Optional: a layer that renders purely from basemap tiles + context (buildings)
   *  omits it, and its `render`/`basemapPatch` receive `null` as data. */
  fetch?(ctx: LayerContext, signal: AbortSignal): Promise<TData>;

  /** Pure. Same inputs -> same layers. No fetching, no side effects. */
  render(data: TData, ctx: LayerContext): DeckLayer[];

  /** Escape hatch: restyle geometry the basemap owns. Buildings layer only. */
  basemapPatch?(data: TData, ctx: LayerContext): BasemapPatch;

  /** Co-located with the layer, rendered into the shell's legend slot. */
  Legend: React.ComponentType<{ data: TData; ctx: LayerContext }>;

  /** Click -> detail card. Omit to make the layer non-interactive. */
  detail?(feature: TFeature, ctx: LayerContext): DetailCardContent;

  /** Declarative user-facing settings. Shell renders the controls generically. */
  options?: Array<{
    key: string;
    label: string;
    type: 'select' | 'toggle' | 'range';
    choices?: { value: string; label: string }[];
    default: string | number | boolean;
  }>;

  /** Declarative mobile degradation. */
  budget: { mobile: 'full' | 'reduced' | 'off' };
}
```

### Per-layer state machine

```
idle ──> loading ──> ready ──> stale ──> error
                       ▲                   │
                       └───────────────────┘
                            retry succeeds
```

`stale` is a **first-class state, not an error**. If the upstream is unreachable, the
layer keeps rendering last-known-good with an amber *"as of 13:50 · stale"* stamp. Silent
staleness is the real failure mode; labelled staleness is a feature.

Each layer owns its own state machine. A dead STM endpoint must never blank the app —
no `Promise.all` across layers.

### `basemapPatch` — why it exists

Three layers *add* geometry. The buildings layer *restyles geometry it does not own*. The
tempting shortcut is to let it reach into the map instance directly, which instantly
breaks the delete-a-folder test. Instead it declares the paint change it wants and
`MapCanvas` applies and reverts it.

### Layer summary

| Layer | `render` returns | `basemapPatch` | `refresh` | `budget.mobile` |
|---|---|---|---|---|
| places | `IconLayer` + `TextLayer` | — | 1 h | `reduced` (cap by viewport) |
| air | `GeoJsonLayer` (sectors) + `ScatterplotLayer` (stations) | — | 5 min | `full` |
| buildings | — | recolour `building-3d` | none (no fetch) | `reduced` (zoom gate) |
| transit | `PathLayer` + `ScatterplotLayer` | — | 20 s | `off` by default |

---

## 5. Data

### Air quality — Montréal RSQA (verified live 2026-08-07)

Source: `https://donnees.montreal.ca/dataset/3e9f7b96-3f25-4404-a5ad-22d9a31060e6/resource/6554355e-63d1-4a01-a268-91e0763c3606/download/iqa-by-station.csv`
Licence: CC-BY. No API key. Updates hourly, ~50 min past the hour.

Verified schema:

```
Id,stationId,address,latitude,longitude,X,Y,pollutant,valeur,date,heure
"1","80","2580 Saint-Joseph est",45.54271,-73.57176,299196.18,5044757.56,"O3",14,"2026-08-07",0
```

Verified facts, and their design consequences:

- **8 active stations across the whole island.** Therefore **no interpolated heatmap.**
  A smooth gradient over 8 points invents thousands of readings that do not exist and
  looks more authoritative the more it lies. Render discrete station markers plus RSQA's
  own sector polygons, flat-filled from their assigned station. Visible sector boundaries
  are honest: they say "administrative attribution", not "measured field".
- **2 pollutants only (O₃, PM2.5).** The legend states both the pollutant set and the
  station count outright.
- **The file contains the whole current day**, every hour (0–18 at time of writing), 16 KB.
  "Current" = `max(heure)`. The remaining hours give a free 24-hour sparkline per station
  and real data for the timeline on day one, at zero extra request cost.
- **Schema seams the normaliser must absorb:** `pollutant` is English while
  `valeur`/`date`/`heure` are French; `stationId` is a zero-padded string (`"06"`, `"03"`)
  and must never be coerced to a number.
- **The URL 302s to a signed `storage.googleapis.com` link.** Native `fetch` follows it.
  This redirect chain plus absent CORS headers is precisely why the server proxy exists.

Station AQI = max of its pollutant sub-indices (Québec IQA convention). **Implementation
task:** confirm the exact band thresholds against RSQA's published methodology before
choosing colour breaks; until confirmed, the ramp is defined in one constant
(`AQI_BANDS`) so correcting it is a one-line change.

### Transit — STM GTFS-Realtime v2

Docs: `https://developpeurs.stm.info/fr/documentation/gtfsrtv2`.
**Requires an API key Nick must register for** at developpeurs.stm.info. Claude cannot
create accounts or handle credentials.

Until `STM_API_KEY` exists in Vercel env, the transit layer is **hidden from the toggles
entirely** — not shown broken. The decode path (`gtfs-realtime-bindings`) is built and
unit-tested against a recorded protobuf fixture, so adding the key either works or fails
loudly.

Static GTFS (route shapes) is fetched at build time into `fixtures/` — it changes a few
times a year, not per request.

**This layer is designed-but-unproven until the key exists.** Stated plainly so it is not
mistaken for verified work.

### Places

Curated JSON seeded from `mymtl`'s 38 places (19 events, 7 culture, 6 bars, 6 views),
which already carry `coord`, `emoji`, `desc`, and date logic including recurring-day
rules (`sundays`, `dows`).

### Buildings (style verified live 2026-08-07)

No route handler. OpenFreeMap Liberty already ships an extrusion layer:

```json
{"id":"building-3d","type":"fill-extrusion","source":"openmaptiles",
 "source-layer":"building","minzoom":14,
 "paint":{"fill-extrusion-base":["get","render_min_height"],
          "fill-extrusion-color":"hsl(35,8%,85%)",
          "fill-extrusion-height":["get","render_height"],
          "fill-extrusion-opacity":0.8}}
```

The layer therefore emits a `basemapPatch` overriding `fill-extrusion-color` on the
existing `building-3d` id. Zero network cost — the cheapest layer to ship.

**Verified constraint on what "buildings as data" can mean in v1.** The OpenMapTiles
`building` source-layer carries `render_height` and `render_min_height` and essentially
nothing else — **no year built, no zoning, no use**. So v1 recolours by *height only*
(a graded skyline). Richer attributes would require joining Montréal's own building
open data by footprint, which is explicitly future work, not v1.

The style's `minzoom: 14` is also where the desktop extrusion budget in §8 comes from —
it is the style's own threshold, not a guess.

### Rules every route handler follows

1. The client never sees an upstream URL.
2. Every response carries `asOf` and `meta`.
3. A failed upstream returns last-cached with `stale: true` — never a 500.
4. `revalidate` is derived from the upstream's own cadence, not from taste.

---

## 6. Shell and interaction

### Chip anchoring — decided

Two styles ship, user-switchable via the places layer's `anchor` option:

- **`leader`** (default) — chip at fixed altitude, hairline down to a ground dot.
  Unambiguous in dense clusters, calm at rest, survives a phone screen.
- **`beam`** — category-tinted column from ground to chip. Visible from across the map
  at any camera angle; louder, and competes with the air and transit layers.

Rejected: *perched on the roof* (chips jump as the camera orbits; anything on a low
building gets buried) and *screen-space pill* (readable but floats "on the glass" rather
than in the city).

These are two branches of one pure `render()`, **not two layers** — mutually exclusive
things are one setting, never two toggles that must not both be on.

### URL as the single source of shell state

```
/?layers=places,air&anchor=beam&t=2026-08-07T18&at=45.5088,-73.5678,15,60,-20
```

Sharing a link shares the exact view. It also gives free undo via browser back, and makes
every bug reproducible by paste. **Discipline:** nothing that belongs in the URL may also
live in component state.

### Desktop

Full-bleed canvas. Layer toggles top-left, each active layer's legend stacked beneath
(generated from the registry). Settings popover per layer. Timeline pinned bottom-centre,
present only when a time-aware layer is on. Detail card slides in from the right on
selection. Camera reset bottom-right.

### Mobile

Same canvas; all chrome collapses into one bottom sheet with three detents — *peek*
(layer chips), *half* (legend + nearby list), *full* (detail). A "near me" button
geolocates and flies the camera. Timeline folds into the sheet.

---

## 7. Failure modes

The map never goes blank.

| Failure | Behaviour |
|---|---|
| Upstream 5xx / timeout | Serve last cached payload, `stale: true`, amber "as of" stamp |
| No cache ever (cold + upstream down) | That layer alone -> `error` with retry; others unaffected |
| Empty rows (hour boundary) | Distinct "no readings" state — **never rendered as a value** |
| WebGL context lost | Listen for `webglcontextlost`, re-init, restore camera from URL |
| Geolocation denied | Silently fall back to city centre. No modal |
| `STM_API_KEY` absent | Transit hidden from toggles, not shown broken |

**Highest-stakes rule in this document:** Québec's AQI is low-is-good, so a missing
reading coerced to `0` paints as *pristine air* — an invisible, reassuring failure.
`null` and `0` must stay distinguishable from CSV parse through to fill colour, and "no
readings" gets its own legend swatch.

---

## 8. Performance budget

| | Desktop | Mobile |
|---|---|---|
| Frame rate | 60 fps target | 30 fps floor |
| Building extrusions | from z≥14 | from z≥15, reduced radius |
| Chips in view | ≤ 60, decluttered by rank | ≤ 20 |
| Transit | on, ~1.8k vehicles | off by default |
| Map libraries | lazy-loaded after first paint | same |

MapLibre + deck.gl is ~400 KB gzipped — too much to block first paint. They load after
the shell renders; each layer's module is dynamically imported only when its toggle is
on. Enabling nothing costs nothing.

---

## 9. Testing

- **Unit (Vitest)** — normalisers against committed fixtures captured from the real
  endpoints. Pure `render()` functions tested by feeding a fixture and a fake context and
  asserting on returned layer descriptors. deck.gl layers are plain config objects until
  the GPU sees them, so most layer logic is testable in Node with no browser.
- **Contract test** — one parametrised test iterating the registry, asserting every
  manifest satisfies the interface. New layers are covered on registration.
- **Architecture test** — ESLint `no-restricted-imports` fails CI if `src/shell` or
  `src/map` reaches into a specific layer folder.
- **E2E (Playwright, Chromium *and* WebKit)** — load; toggle each layer and assert its
  legend appears; assert the URL round-trips a shared view; assert the stale banner
  appears with the API mocked to fail. WebKit is mandatory, not optional — Safari
  diverges on WebGL often enough to be a recurring source of bugs.
- **Canvas pixel assertion** — sample the canvas and assert the pixels are not uniform.
  WebGL failures do not throw; they produce a correctly-sized black canvas that passes
  every DOM assertion. This is the check that distinguishes "the app mounted" from "the
  map drew".

---

## 10. Open items owned by Nick

1. **Register for an STM API key** at developpeurs.stm.info and add `STM_API_KEY` to
   Vercel env. Until then the transit layer stays hidden.
2. **Confirm the RSQA AQI band thresholds** against published methodology, or approve the
   `AQI_BANDS` constant once drafted.
