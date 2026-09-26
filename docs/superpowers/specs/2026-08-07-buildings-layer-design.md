# Buildings Layer — Design

**Date:** 2026-08-07
**Status:** Approved design, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-08-07-mycityvisualization-design.md`
**Workstream:** 3D-buildings pipeline session (division of labor agreed 2026-08-07: the app-shell session owns `src/`+`app/`; this workstream owns the pipeline and delivers this layer against the existing contract)

---

## 1. Goal & scope

A `buildings` layer for MyCityVisualization showing the **official Ville de Montréal 2020 LOD2 model** — real roof geometry, survey-derived heights — for the Ville-Marie borough. Geometry only, styled matte to sit in the dark Liberty basemap. Where the official model has coverage, the basemap's generic extrusions fade out; beyond coverage they remain. Detailed downtown, simple boxes elsewhere — by design, honest in the legend.

### Non-goals for v1

- **No textures.** The pipeline preserves the textured CityJSON on disk; a "photo mode" is a later, additive project.
- **No per-building picking / detail cards.** Arrives with a 3D-Tiles or custom-layer upgrade (the glbs already carry one named node per building so that upgrade reuses this pipeline).
- **No 2020 CDN-NDG/Outremont, no 2016 boroughs.** Ville-Marie first; other boroughs are a pipeline re-run plus an assets-hosting decision (§4), not a design change.
- **No data-driven coloring yet** (building age/energy/etc.). The attributes (`measuredHeight`, `Volume`, `parcelle`, gml id) survive into the tiles manifest for that future — though in the 2020 VM data `parcelle` is whitespace-only on every shipped building; only `measuredHeight`, `Volume`, and the gml id are usable until a future dataset populates it.

## 2. Source data

| Dataset | Coverage | Format | Size |
|---|---|---|---|
| Bâtiments 3D 2020 (Maquette LOD2 avec textures) — **used** | Ville-Marie, CDN–NDG, Outremont | CityGML/3DM/DWG | ~30 GB total; VM GML packs 2.5+2.5+2.1 GB |
| Bâtiments 3D 2016 (LOD2 avec textures) — future | adds Plateau, Sud-Ouest, Verdun | CityGML/3DM/FGDB | undeclared in CKAN; VM pack 4.8 GB |

- Portal: `donnees.montreal.ca`, CKAN API (`/api/3/action/package_show`, dataset id `batiments-3d-2020-maquette-lod2-avec-textures`).
- **Download quirk:** GET on portal `/download/*.zip` URLs returns `403 "RBAC: access denied"` to scripted clients. The pipeline reads the `Location` header from the 302 and downloads the signed `montreal-prod.storage.googleapis.com` URL directly (supports HTTP ranges; resumable).
- **CRS:** files declare no `srsName`. Coordinates (X≈300 km, Y≈5,040 km, Z in meters) are NAD83 MTM zone 8; the pipeline treats the data as **EPSG:2950**, guarded by golden-value reprojection tests (§7).
- **Exporter quirks (Rhinocity):** non-canonical CityGML namespace URIs (harmless to conversion; warning expected), inconsistent per-face texture arrays (crashes cjio; we strip appearance for geometry mode), ~1% degenerate rings/faces (sanitized explicitly, §3).
- **License:** Montréal open data is published under CC BY 4.0 — confirm on the dataset page during implementation and credit "Ville de Montréal" in the layer legend.

## 3. Pipeline (`scripts/pipeline/`, Python, offline)

Five deterministic, individually re-runnable steps. Raw and intermediate artifacts live under gitignored `data/`; only final web assets and the manifest leave it.

1. **fetch** — resolve CKAN resource → signed GCS URL → download with resume + size verification against frozen expected sizes (stronger than trusting the live `Content-Length`: a republished/tampered dataset surfaces as a size-mismatch error, not a silent swap); unpack nested per-tile zips.
2. **to-cityjson** — citygml-tools 2.5.0 (Java 26 via Homebrew), `to-cityjson`. Output: `<tile>.json` (textured CityJSON, kept as the photo-mode source of truth).
3. **strip** — remove `appearance` and per-geometry `texture`/`material` → `<tile>.geom.json`.
4. **glb** — the converter proven in the spike (promoted to `scripts/pipeline/cityjson_to_glb.py`): clean rings (drop consecutive duplicates and closing repeats), skip sub-3-vertex rings and zero-normal surfaces **with counts reported**, Newell-basis projection, mapbox-earcut triangulation with holes, one named `trimesh` node per building (name = CityGML building id), recenter to tile min-corner, Y-up axis swap. Fails that tile's run if its skip rate exceeds 2% of surfaces — loud, not silent.
5. **manifest** — emit `public/tiles/buildings/vm/tiles-manifest.json`: per tile `{ id, path, anchorMtm8: [E,N,h], anchor: [lng,lat], trianglesCount, buildingsCount, extentWgs84 }`, anchors reprojected EPSG:2950→EPSG:4326 with pyproj. Toolchain lives in `data/tools/` venvs (Python 3.12 for the triangle dependency; 3.14 works for everything else).

Measured baseline (VM06, smallest tile): 67 MB GML → 5.6 MB CityJSON → 1.6 MB glb; 243 buildings, 82,627 triangles, 6 s conversion; 683 degenerate rings + 18 zero-normal surfaces skipped (~1%), no visible holes in render.

## 4. Assets & hosting

- Generated glbs → `public/tiles/buildings/vm/VM0N_2020.glb`, **committed to git** (est. 10–40 MB for six tiles; same-origin serving satisfies the parent spec's "client never fetches a third party" constraint; Vercel serves `public/` statically with gzip).
- **Known future fork:** adding boroughs will multiply size (~3× for full 2020, more for 2016). Past ~100 MB of committed assets, move glbs to Vercel Blob behind a same-origin route (or git-lfs). Decision deferred until a second borough is actually wanted.

## 5. Layer module (`src/layers/buildings/`, TypeScript — built in Phase B, §8)

Conforms to `src/layers/types.ts` as of commit `f006355`:

- **`id`** `'buildings'`, label "3D Buildings (official)".
- **No `fetch`.** `tiles-manifest.json` is statically imported (`@/public/tiles/buildings/vm/tiles-manifest.json` — the `@/*` alias resolves from the repo root per the parent plan, so importing JSON that lives beside the glbs works and keeps Phase A out of `src/`); glbs stream via ScenegraphLayer's own loader. No `refresh` — never stale.
- **`render(data, ctx)`** — one `ScenegraphLayer` with six data rows (one per tile), each row `{ scenegraph: path, coordinateOrigin: [lng, lat, hMin], coordinateSystem: METER_OFFSETS }`. Pure; same ctx → same layers. Matte material, single accent-neutral color from the app palette, flat shading; no per-object color in v1.
- **`basemapPatch(data, ctx)`** — targets Liberty's `building-3d`: `fill-extrusion-opacity → 0.05` while the layer is on. Restore is the shell's existing `revertPatch` — this layer never touches MapLibre directly.
- **`Legend`** — "Official 3D model (2020) · Ville-Marie coverage · Ville de Montréal (CC BY)". Shows tile-load state (§6).
- **`options`** — one toggle: `fadeGenericBuildings` (default on) controlling whether `basemapPatch` applies.
- **`budget.mobile: 'reduced'`** — on mobile, glbs load only at zoom ≥ 13, nearest 3 tiles by camera-to-anchor distance; below that zoom the layer contributes nothing and Liberty extrusions stay.

## 6. Error handling

| Failure | Behavior |
|---|---|
| One glb fails to load (404/network/parse) | Remaining tiles render; layer status `stale`; legend shows "5/6 tiles loaded"; error logged with tile id |
| All glbs fail | Status `error`; `basemapPatch` not applied (generic extrusions remain — map never loses buildings entirely) |
| Manifest import missing/invalid | Build-time failure (static import + type check), cannot ship |
| Pipeline skip-rate > 2% on any tile | Pipeline exits non-zero; no assets emitted for that tile |

## 7. Testing

- **Pipeline (pytest, runs in the 3.12 venv):** ring-cleaning units (duplicate collapse, closing-vertex removal, degenerate skip); skip-counter correctness on a crafted malformed fixture; glb roundtrip (load exported file, assert building-node count and triangle count match the report); **reprojection goldens** — VM06's anchor `(300462.96875, 5040621.0)` and one hand-verified downtown landmark, asserted within ±2 m of EPSG-registry-derived WGS84 values computed once at implementation and frozen into the test.
- **Layer (Vitest):** `render()` purity and row count against fixture manifest + ctx variants (desktop/mobile, zoom above/below 13); `basemapPatch` emitted only when `fadeGenericBuildings` on.
- **E2E (Playwright, Chromium + WebKit):** joins the app's existing suite in Phase B — toggle layer on, assert canvas draws and legend text; runs against the six real glbs.
- **Visual:** `scripts/pipeline/preview.py` renders every converted tile top-down (height-colored) — a human checks each new borough run once.

## 8. Phasing & coordination

- **Phase A (now):** pipeline scripts + six VM glbs + manifest + pytest suite, on branch `buildings-pipeline` (based off `main`; touches only `scripts/`, `docs/`, `public/tiles/`, gitignored `data/`, plus a `.gitignore` whose add/add union-merge with `design/foundation` is trivial). Work is committed via a linked worktree so the shared working tree (live on `design/foundation` with another active session) is never switched or disturbed.
- **Phase B (after the app session's Plan 1 lands):** implement `src/layers/buildings/` per §5, register in the registry, Playwright e2e, Vercel preview link.
- Nothing is pushed to any remote, and no PR is opened, without explicit go-ahead. Nothing in this workstream ever commits to `design/foundation` or `main` directly.

## 9. Risks

| Risk | Mitigation |
|---|---|
| VM04 (densest tile, 948 MB pack) may produce a heavy glb | Size gate in pipeline report; if a tile exceeds ~15 MB raw, add meshopt compression to step 4 before shipping Phase B |
| deck.gl ScenegraphLayer glTF quirks (materials/normals via luma.gl) | Phase B starts with a one-tile smoke test in the app before wiring all six |
| Rhinocity quirks vary across tiles | Skip-rate gate (2%) + per-tile preview render catch anomalies at pipeline time, not in the browser |
| Two sessions, one working tree | This workstream: linked worktrees only, never `git switch` in the shared tree, no `src/`/`app/` writes until Plan 1 lands |
