import json
import subprocess

from scripts.pipeline.config import CITYGML_TOOLS, JAVA_HOME
from scripts.pipeline.convert import strip_appearance
from .conftest import FIXTURES


def test_strip_appearance_removes_all_refs(tmp_path):
    dst = tmp_path / "geom.json"
    removed = strip_appearance(FIXTURES / "mini_textured.city.json", dst)
    assert removed == 1
    d = json.loads(dst.read_text())
    assert "appearance" not in d
    assert all(
        "texture" not in g and "material" not in g
        for o in d["CityObjects"].values() for g in o["geometry"])


def test_citygml_tools_is_runnable():
    r = subprocess.run(
        [str(CITYGML_TOOLS), "--version"],
        env={"JAVA_HOME": JAVA_HOME, "PATH": "/usr/bin:/bin"},
        capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and "2.5.0" in r.stdout
