from scripts.pipeline.glbtool import convert_tile
from scripts.pipeline.preview import render_preview
from .conftest import FIXTURES


def test_preview_renders_png(tmp_path, monkeypatch):
    # fixture is deliberately 1/13 ≈ 7.7% malformed; production gate stays 0.02
    import scripts.pipeline.glbtool as g
    monkeypatch.setattr(g, "SKIP_RATE_MAX", 0.10)

    glb = tmp_path / "mini.glb"
    convert_tile(FIXTURES / "mini.city.json", glb)
    png = tmp_path / "mini.png"
    render_preview(glb, png, "mini")
    assert png.stat().st_size > 1000
