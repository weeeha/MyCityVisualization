import json

from pyproj import Transformer

from scripts.pipeline.reproject import build_manifest, extent_wgs84, to_wgs84, write_attributes_sidecar
from .conftest import FIXTURES


def test_vm06_anchor_lands_in_downtown_montreal():
    lng, lat = to_wgs84(300462.96875, 5040621.0)
    assert -73.62 < lng < -73.50
    assert 45.47 < lat < 45.56


def test_roundtrip_within_a_centimeter():
    lng, lat = to_wgs84(300462.96875, 5040621.0)
    inv = Transformer.from_crs(4326, 2950, always_xy=True)
    e, n = inv.transform(lng, lat)
    assert abs(e - 300462.96875) < 0.01 and abs(n - 5040621.0) < 0.01


def test_extent_wgs84_corners_reproject_and_order():
    ext = [300462.96875, 5040621.0, 6.579621, 301558.1875, 5043559.0, 87.219002]
    w, s, e, n = extent_wgs84(ext)
    assert w < e and s < n
    assert -73.62 < w < -73.50 and -73.62 < e < -73.50
    assert 45.47 < s < 45.56 and 45.47 < n < 45.56
    inv = Transformer.from_crs(4326, 2950, always_xy=True)
    e_sw, n_sw = inv.transform(w, s)
    e_ne, n_ne = inv.transform(e, n)
    assert abs(e_sw - 300462.96875) < 0.01 and abs(n_sw - 5040621.0) < 0.01
    assert abs(e_ne - 301558.1875) < 0.01 and abs(n_ne - 5043559.0) < 0.01


def test_manifest_schema():
    # reports now carry their own `extent` (F5) — no separate extents map
    reports = [
        {"tile": "VM06", "buildings": 243, "triangles": 82627,
         "skipped": {}, "surfaces": 64110, "skip_rate": 0.0107,
         "anchor_mtm8": [300462.96875, 5040621.0, 6.579621], "glb_bytes": 1,
         "extent": [300462.9, 5040621.0, 6.5, 301558.2, 5043559.0, 87.3]},
        {"tile": "VM01", "buildings": 100, "triangles": 40000,
         "skipped": {}, "surfaces": 30000, "skip_rate": 0.02,
         "anchor_mtm8": [300500.0, 5041000.0, 5.0], "glb_bytes": 1,
         "extent": [300500.0, 5041000.0, 5.0, 301500.0, 5042000.0, 50.0]},
    ]
    m = build_manifest(reports)

    assert [t["id"] for t in m["tiles"]] == ["VM01", "VM06"]
    t = m["tiles"][1]
    assert t["path"] == "/tiles/buildings/vm/VM06_2020.glb"
    assert t["attributesPath"] == "/tiles/buildings/vm/VM06_attributes.json"
    assert len(t["anchor"]) == 2 and len(t["extentWgs84"]) == 4
    assert isinstance(t["skipRate"], float) and t["skipRate"] == 0.0107

    assert m["license"] == "CC-BY-4.0" and m["crsSource"] == "EPSG:2950"
    assert m["axis"] == "Y_UP"
    assert "meters from anchorMtm8" in m["originRule"]
    assert m["hasNormals"] is False
    assert m["source"] == {
        "dataset": "batiments-3d-2020-maquette-lod2-avec-textures",
        "resource": "7bff216d-bf3f-4c90-8677-2aceca08a360",
    }


def test_attributes_sidecar(tmp_path):
    out = tmp_path / "attrs.json"
    n = write_attributes_sidecar(FIXTURES / "mini.city.json", out)
    d = json.loads(out.read_text())
    assert n == 2 and d["B1"]["measuredHeight"] == 3.0
