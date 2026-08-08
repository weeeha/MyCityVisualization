import json

import pytest
import trimesh

from scripts.pipeline.glbtool import PipelineError, convert_tile
from .conftest import FIXTURES


def test_convert_tile_roundtrip(tmp_path, monkeypatch):
    # fixture is deliberately 1/13 ≈ 7.7% malformed; production gate stays 0.02
    import scripts.pipeline.glbtool as g
    monkeypatch.setattr(g, "SKIP_RATE_MAX", 0.10)

    out = tmp_path / "mini.glb"
    report = convert_tile(FIXTURES / "mini.city.json", out)

    assert report["buildings"] == 2
    assert report["triangles"] == 24            # 12 per clean cube
    assert report["skipped"]["degenerate_ring"] == 1
    assert report["anchor_mtm8"] == [0.0, 0.0, 0.0]
    assert report["glb_bytes"] == out.stat().st_size

    sc = trimesh.load(out)
    assert set(sc.geometry.keys()) == {"B1", "B2"}
    assert sum(len(g.faces) for g in sc.geometry.values()) == 24


def test_convert_tile_enforces_skip_gate(tmp_path, monkeypatch):
    import scripts.pipeline.glbtool as g
    monkeypatch.setattr(g, "SKIP_RATE_MAX", 0.0)
    with pytest.raises(PipelineError):
        convert_tile(FIXTURES / "mini.city.json", tmp_path / "x.glb")
