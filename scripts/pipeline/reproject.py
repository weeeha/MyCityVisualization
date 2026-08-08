import json
from pathlib import Path

from pyproj import Transformer

from scripts.pipeline.config import ATTRIBUTION, EPSG_SRC

_T = Transformer.from_crs(EPSG_SRC, 4326, always_xy=True)


def to_wgs84(e, n):
    lng, lat = _T.transform(e, n)
    return float(lng), float(lat)


def extent_wgs84(ext):
    w, s = to_wgs84(ext[0], ext[1])
    e, n = to_wgs84(ext[3], ext[4])
    return [w, s, e, n]


def write_attributes_sidecar(geom_json, out_json):
    d = json.loads(Path(geom_json).read_text())
    attrs = {oid: o.get("attributes", {}) for oid, o in d["CityObjects"].items()}
    Path(out_json).write_text(json.dumps(attrs, separators=(",", ":")))
    return len(attrs)


def build_manifest(reports, extents):
    tiles = []
    for r in sorted(reports, key=lambda x: x["tile"]):
        e, n, h = r["anchor_mtm8"]
        lng, lat = to_wgs84(e, n)
        tiles.append({
            "id": r["tile"],
            "path": f"/tiles/buildings/vm/{r['tile']}_2020.glb",
            "anchorMtm8": r["anchor_mtm8"],
            "anchor": [lng, lat],
            "buildingsCount": r["buildings"],
            "trianglesCount": r["triangles"],
            "extentWgs84": extent_wgs84(extents[r["tile"]]),
        })
    return {"version": 1, "license": "CC-BY-4.0", "attribution": ATTRIBUTION,
            "crsSource": f"EPSG:{EPSG_SRC}", "tiles": tiles}
