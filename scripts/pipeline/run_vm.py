"""End-to-end: official VM pack -> six geometry glbs + manifest. Idempotent."""
import json
import shutil
import sys

from scripts.pipeline import config
from scripts.pipeline.convert import gml_to_cityjson, strip_appearance
from scripts.pipeline.glbtool import PipelineError, convert_tile
from scripts.pipeline.portal import download, resolve_signed_url, resource_url, unpack_inner
from scripts.pipeline.preview import render_preview
from scripts.pipeline.reproject import build_manifest, write_attributes_sidecar


def main():
    outer = config.RAW / config.VM_PACK_NAME
    url = resolve_signed_url(resource_url(config.VM_PACK_RESOURCE, config.VM_PACK_NAME))
    download(url, outer, config.VM_PACK_SIZE)

    reports, extents, oversized = [], {}, []
    previews = config.DATA / "previews"
    previews.mkdir(exist_ok=True)
    for tile in config.TILES:
        tile_dir = unpack_inner(outer, f"{tile}_2020_GML.zip", config.TILES_DIR)
        gml = tile_dir / f"{tile}_2020.gml"
        cj = gml.with_suffix(".json")
        if not cj.exists():
            cj = gml_to_cityjson(gml)
        geom = tile_dir / f"{tile}_2020.geom.json"
        if not geom.exists():
            strip_appearance(cj, geom)
        glb = config.OUT_DIR / f"{tile}_2020.glb"
        report = convert_tile(geom, glb)
        extents[tile] = json.loads(geom.read_text())["metadata"]["geographicalExtent"]
        write_attributes_sidecar(geom, config.OUT_DIR / f"{tile}_attributes.json")
        render_preview(glb, previews / f"{tile}.png", tile)
        reports.append(report)
        mb = report["glb_bytes"] / 1e6
        if mb > config.GLB_SIZE_MAX_MB:
            oversized.append((tile, mb))
        print(f"{tile}: {report['buildings']} bldgs, {report['triangles']} tris, "
              f"{mb:.1f} MB, skip {report['skip_rate']:.2%}")

    manifest = build_manifest(reports, extents)
    (config.OUT_DIR / "tiles-manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")))
    if oversized:
        print(f"SIZE GATE: {oversized} exceed {config.GLB_SIZE_MAX_MB} MB — "
              "do NOT commit; decide on compression (spec §9).")
        sys.exit(2)
    print("OK: all tiles within size gate.")


if __name__ == "__main__":
    main()
