# Buildings — Ville-Marie 2020 LOD2 (geometry only)

**Source dataset:** Bâtiments 3D 2020 — Maquette LOD2 avec textures
**Portal:** https://donnees.montreal.ca/dataset/batiments-3d-2020-maquette-lod2-avec-textures
**Resource id:** `7bff216d-bf3f-4c90-8677-2aceca08a360` (`vm_2020_gml_01_06.zip` — Ville-Marie borough, tiles VM01–VM06)

**License:** CC BY 4.0
**Attribution:** Ville de Montréal

**Generated:** 2026-08-08, by the pipeline in [`scripts/pipeline/`](../../../../scripts/pipeline). See
[`docs/superpowers/specs/2026-08-07-buildings-layer-design.md`](../../../../docs/superpowers/specs/2026-08-07-buildings-layer-design.md)
for the full design and
[`docs/superpowers/plans/2026-08-07-buildings-pipeline.md`](../../../../docs/superpowers/plans/2026-08-07-buildings-pipeline.md)
for the implementation plan.

## Contract

`tiles-manifest.json` in this directory fully describes the handoff to the app layer:

- `tiles[].path` / `tiles[].attributesPath` — the glb and its per-building attribute sidecar (`{buildingId: attributes}`, keyed identically to the glb's named nodes)
- `tiles[].anchorMtm8` / `tiles[].anchor` — tile origin in the source CRS (NAD83(CSRS) MTM zone 8, EPSG:2950) and reprojected WGS84 `[lng, lat]`
- `axis: "Y_UP"` and `originRule` — the glTF axis convention and how each mesh's local positions relate back to `anchorMtm8`
- `hasNormals: false` — normals are generated (fixed) during conversion, not carried from the exporter
- `tiles[].skipRate` — the sanitizer's skipped-surface rate for that tile (gated at 2% at generation time)
- `source` — the CKAN dataset id and resource id this run was generated from

## Note on textures

Textures were intentionally stripped during conversion — this is a **geometry-only v1**. The textured CityJSON remains the pipeline's intermediate source of truth (gitignored, not shipped here) for a possible future "photo mode".
