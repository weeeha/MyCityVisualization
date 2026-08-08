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


def test_manifest_schema(tmp_path):
    report = {"tile": "VM06", "buildings": 243, "triangles": 82627,
              "skipped": {}, "surfaces": 64110, "skip_rate": 0.01,
              "anchor_mtm8": [300462.96875, 5040621.0, 6.579621], "glb_bytes": 1}
    m = build_manifest([report], {"VM06": [300462.9, 5040621.0, 6.5, 301558.2, 5043559.0, 87.3]})
    t = m["tiles"][0]
    assert t["path"] == "/tiles/buildings/vm/VM06_2020.glb"
    assert len(t["anchor"]) == 2 and len(t["extentWgs84"]) == 4
    assert m["license"] == "CC-BY-4.0" and m["crsSource"] == "EPSG:2950"


def test_attributes_sidecar(tmp_path):
    out = tmp_path / "attrs.json"
    n = write_attributes_sidecar(FIXTURES / "mini.city.json", out)
    d = json.loads(out.read_text())
    assert n == 2 and d["B1"]["measuredHeight"] == 3.0
