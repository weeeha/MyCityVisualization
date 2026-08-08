"""End-to-end: official VM pack -> six geometry glbs + manifest. Idempotent.

Per-tile stage outputs are written to a staging directory first; only after
every tile in config.TILES succeeds (and none trips the size gate) are the
glbs, sidecars, and manifest moved into config.OUT_DIR (the promote step). A
partial or failed run never touches OUT_DIR's previously committed assets.
"""
import json
import shutil
import sys

from scripts.pipeline import config
from scripts.pipeline.convert import gml_to_cityjson, strip_appearance
from scripts.pipeline.glbtool import PipelineError, convert_tile
from scripts.pipeline.portal import download, resolve_signed_url, resource_url, unpack_inner
from scripts.pipeline.preview import render_preview
from scripts.pipeline.reproject import build_manifest, write_attributes_sidecar


def _process_tile(tile, outer, staging, previews):
    """Run one tile's fetch->glb->sidecar->preview chain into the staging dir."""
    tile_dir = unpack_inner(outer, f"{tile}_2020_GML.zip", config.TILES_DIR)
    gml = tile_dir / f"{tile}_2020.gml"
    cj = gml.with_suffix(".json")
    if not cj.exists():
        cj = gml_to_cityjson(gml)
    geom = tile_dir / f"{tile}_2020.geom.json"
    if not geom.exists():
        strip_appearance(cj, geom)
    glb = staging / f"{tile}_2020.glb"
    report = convert_tile(geom, glb)
    write_attributes_sidecar(geom, staging / f"{tile}_attributes.json")
    render_preview(glb, previews / f"{tile}.png", tile)
    return report


def main():
    outer = config.RAW / config.VM_PACK_NAME
    url = resolve_signed_url(resource_url(config.VM_PACK_RESOURCE, config.VM_PACK_NAME))
    download(url, outer, config.VM_PACK_SIZE)

    staging = config.DATA / "staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    previews = config.DATA / "previews"
    previews.mkdir(parents=True, exist_ok=True)

    reports, oversized, failed = [], [], []
    for tile in config.TILES:
        try:
            report = _process_tile(tile, outer, staging, previews)
        except PipelineError as e:
            failed.append((tile, str(e)))
            print(f"{tile}: FAILED — {e}")
            continue
        reports.append(report)
        mb = report["glb_bytes"] / 1e6
        if mb > config.GLB_SIZE_MAX_MB:
            oversized.append((tile, mb))
        print(f"{tile}: {report['buildings']} bldgs, {report['triangles']} tris, "
              f"{mb:.1f} MB, skip {report['skip_rate']:.2%}")

    if failed:
        print("FAILED TILES:")
        for tile, err in failed:
            print(f"  {tile}: {err}")
        print(f"{config.OUT_DIR} left untouched.")
        sys.exit(3)

    if oversized:
        print(f"SIZE GATE: {oversized} exceed {config.GLB_SIZE_MAX_MB} MB — "
              "do NOT commit; decide on compression (spec §9).")
        print(f"{config.OUT_DIR} left untouched.")
        sys.exit(2)

    manifest = build_manifest(reports)
    (staging / "tiles-manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")))

    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in staging.iterdir():
        shutil.move(str(f), str(config.OUT_DIR / f.name))
    shutil.rmtree(staging, ignore_errors=True)

    print("OK: all tiles within size gate.")


if __name__ == "__main__":
    main()
