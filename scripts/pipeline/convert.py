import json
import subprocess
from pathlib import Path

from scripts.pipeline.config import CITYGML_TOOLS, JAVA_HOME
from scripts.pipeline.glbtool import PipelineError


def strip_appearance(src, dst):
    d = json.loads(Path(src).read_text())
    d.pop("appearance", None)
    removed = 0
    for o in d["CityObjects"].values():
        for g in o.get("geometry", []):
            for k in ("texture", "material"):
                if k in g:
                    g.pop(k)
                    removed += 1
    Path(dst).write_text(json.dumps(d, separators=(",", ":")))
    return removed


def gml_to_cityjson(gml):
    gml = Path(gml)
    out = gml.with_suffix(".json")
    r = subprocess.run(
        [str(CITYGML_TOOLS), "to-cityjson", str(gml)],
        env={"JAVA_HOME": JAVA_HOME, "PATH": "/usr/bin:/bin"},
        capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        raise PipelineError(f"citygml-tools failed on {gml.name}: {r.stderr[-500:]}")
    return out
