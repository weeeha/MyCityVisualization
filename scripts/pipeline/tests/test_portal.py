import zipfile

import pytest

from scripts.pipeline.glbtool import PipelineError
from scripts.pipeline.portal import resource_url, unpack_inner, verify_size


def test_resource_url_shape():
    u = resource_url("abc-123", "vm.zip")
    assert u == "https://donnees.montreal.ca/dataset/batiments-3d-2020-maquette-lod2-avec-textures/resource/abc-123/download/vm.zip"


def test_verify_size_raises_on_mismatch(tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"1234")
    verify_size(f, 4)
    with pytest.raises(PipelineError):
        verify_size(f, 5)


def test_unpack_inner_extracts_nested_zip(tmp_path):
    inner = tmp_path / "VM99_2020_GML.zip"
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("VM99_2020.gml", "<gml/>")
    outer = tmp_path / "outer.zip"
    with zipfile.ZipFile(outer, "w") as z:
        z.write(inner, inner.name)
    tile_dir = unpack_inner(outer, "VM99_2020_GML.zip", tmp_path / "work")
    assert (tile_dir / "VM99_2020.gml").read_text() == "<gml/>"
