"""Orchestrator tests. Every stage function is monkeypatched — no real data,
no network — so only run_vm.main()'s staging/promote/failure-handling logic
is under test.
"""
import json
from pathlib import Path

import pytest

import scripts.pipeline.run_vm as run_vm
from scripts.pipeline.glbtool import PipelineError


def _fake_report(tile):
    return {
        "tile": tile,
        "buildings": 2,
        "triangles": 24,
        "skipped": {"degenerate_ring": 0, "no_normal": 0, "earcut_empty": 0},
        "surfaces": 12,
        "skip_rate": 0.0,
        "anchor_mtm8": [0.0, 0.0, 0.0],
        "extent": [0.0, 0.0, 0.0, 7.0, 2.0, 3.0],
        "glb_bytes": 10,
    }


@pytest.fixture
def staged_env(tmp_path, monkeypatch):
    """Point config at a scratch tree and stub every stage function."""
    data_dir = tmp_path / "data"
    out_dir = tmp_path / "public" / "tiles" / "buildings" / "vm"

    monkeypatch.setattr(run_vm.config, "DATA", data_dir)
    monkeypatch.setattr(run_vm.config, "RAW", data_dir / "raw")
    monkeypatch.setattr(run_vm.config, "TILES_DIR", data_dir / "tiles")
    monkeypatch.setattr(run_vm.config, "OUT_DIR", out_dir)
    monkeypatch.setattr(run_vm.config, "TILES", ["VM01", "VM02", "VM03"])

    monkeypatch.setattr(run_vm, "resource_url", lambda rid, name: "https://example.test/download")
    monkeypatch.setattr(
        run_vm, "resolve_signed_url",
        lambda url: "https://montreal-prod.storage.googleapis.com/x.zip")

    def fake_download(url, dest, expected_size=None):
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"outer-zip")
    monkeypatch.setattr(run_vm, "download", fake_download)

    def fake_unpack_inner(outer, inner_name, work_dir):
        tile = inner_name.split("_")[0]
        tile_dir = Path(work_dir) / tile
        tile_dir.mkdir(parents=True, exist_ok=True)
        (tile_dir / f"{tile}_2020.gml").write_text("<gml/>")
        return tile_dir
    monkeypatch.setattr(run_vm, "unpack_inner", fake_unpack_inner)

    def fake_gml_to_cityjson(gml):
        out = gml.with_suffix(".json")
        out.write_text("{}")
        return out
    monkeypatch.setattr(run_vm, "gml_to_cityjson", fake_gml_to_cityjson)

    def fake_strip_appearance(src, dst):
        Path(dst).write_text("{}")
        return 0
    monkeypatch.setattr(run_vm, "strip_appearance", fake_strip_appearance)

    def fake_write_attributes_sidecar(geom_json, out_json):
        Path(out_json).write_text('{"B1":{},"B2":{}}')
        return 2
    monkeypatch.setattr(run_vm, "write_attributes_sidecar", fake_write_attributes_sidecar)

    monkeypatch.setattr(run_vm, "render_preview", lambda glb, png, title: None)

    return data_dir, out_dir


def test_all_tiles_succeed_promotes_to_out_dir(staged_env, monkeypatch):
    data_dir, out_dir = staged_env

    def fake_convert_tile(geom, glb):
        tile = Path(geom).stem.split("_")[0]
        Path(glb).write_bytes(f"GLB-{tile}".encode())
        return _fake_report(tile)
    monkeypatch.setattr(run_vm, "convert_tile", fake_convert_tile)

    run_vm.main()

    assert out_dir.is_dir()
    manifest = json.loads((out_dir / "tiles-manifest.json").read_text())
    assert [t["id"] for t in manifest["tiles"]] == list(run_vm.config.TILES)
    for tile in run_vm.config.TILES:
        assert (out_dir / f"{tile}_2020.glb").exists()
        assert (out_dir / f"{tile}_attributes.json").exists()
    # staging is cleaned up once its contents are promoted
    assert not (data_dir / "staging").exists()


def test_middle_tile_failure_exits_3_and_leaves_out_dir_untouched(staged_env, monkeypatch):
    data_dir, out_dir = staged_env
    out_dir.mkdir(parents=True)
    sentinel = out_dir / "VM01_2020.glb"
    sentinel.write_bytes(b"PREVIOUSLY-COMMITTED")

    def fake_convert_tile(geom, glb):
        tile = Path(geom).stem.split("_")[0]
        if tile == "VM02":
            raise PipelineError(f"{tile}: synthetic failure")
        Path(glb).write_bytes(f"GLB-{tile}".encode())
        return _fake_report(tile)
    monkeypatch.setattr(run_vm, "convert_tile", fake_convert_tile)

    with pytest.raises(SystemExit) as exc_info:
        run_vm.main()

    assert exc_info.value.code == 3
    # OUT_DIR must be exactly what it was before the run — nothing added or removed
    assert list(out_dir.iterdir()) == [sentinel]
    assert sentinel.read_bytes() == b"PREVIOUSLY-COMMITTED"


def test_oversized_tile_exits_2_and_leaves_out_dir_untouched(staged_env, monkeypatch):
    data_dir, out_dir = staged_env
    monkeypatch.setattr(run_vm.config, "GLB_SIZE_MAX_MB", 0.0)  # everything trips the gate

    def fake_convert_tile(geom, glb):
        tile = Path(geom).stem.split("_")[0]
        Path(glb).write_bytes(f"GLB-{tile}".encode())
        report = _fake_report(tile)
        report["glb_bytes"] = 1_000_000
        return report
    monkeypatch.setattr(run_vm, "convert_tile", fake_convert_tile)

    with pytest.raises(SystemExit) as exc_info:
        run_vm.main()

    assert exc_info.value.code == 2
    assert not out_dir.exists()
