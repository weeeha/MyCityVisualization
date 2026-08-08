# Buildings Pipeline (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic offline pipeline that turns the official Ville de Montréal 2020 LOD2 CityGML into six web-ready, per-building-node glbs plus a georeferenced tiles manifest, with tests.

**Architecture:** Small Python package `scripts/pipeline/` with one module per pipeline stage (fetch → GML→CityJSON → strip → glb → manifest), a pure-function core (ring cleaning, triangulation) unit-tested in isolation, and an orchestrator that re-runs any stage idempotently. Heavy conversion (GML→CityJSON) delegates to citygml-tools (Java); everything else is Python.

**Tech Stack:** Python 3.12 venv at `data/tools/cjenv312` (numpy, mapbox_earcut, trimesh, scipy, networkx, matplotlib, pyproj, pytest), citygml-tools 2.5.0 at `data/tools/citygml-tools-2.5.0`, OpenJDK via `/opt/homebrew/opt/openjdk`, curl for downloads.

**Spec:** `docs/superpowers/specs/2026-08-07-buildings-layer-design.md`

## Global Constraints

- **Work only in the `buildings-pipeline` worktree** (`…/scratchpad/wt-buildings`). Never `git switch` in the shared tree at the repo root; never write to `src/` or `app/` (frozen until the foundation session's Plan 1 lands).
- **Python:** `data/tools/cjenv312/bin/python` for everything (the `triangle`-free toolchain; 3.14 lacks wheels we need). Data dirs are relative to the **repo root**, not the worktree — raw data lives once, in the main checkout's gitignored `data/`.
- **Java:** `JAVA_HOME=/opt/homebrew/opt/openjdk` for every citygml-tools call.
- **CRS:** source is treated as **EPSG:2950** (files declare nothing); all WGS84 output via pyproj `always_xy=True`.
- **Skip gate:** a tile fails its run if sanitizer skip rate > **2%** of surfaces (`SKIP_RATE_MAX = 0.02`).
- **Size gate:** any raw glb > **15 MB** stops before commit for a compression decision (spec §9).
- **Downloads:** portal `/download/` URLs 403 for scripts — always resolve the 302 `Location` to the signed GCS URL first; verify byte size against `Content-Length`.
- **Commits:** one per task, message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Push only to `buildings-pipeline` (updates PR #1). Never commit to `main` or `design/foundation`.
- **Deviation from spec §1, recorded:** per-building attributes are emitted as a per-tile sidecar `VM0N_attributes.json` rather than inside `tiles-manifest.json`, keeping the manifest small enough to static-import.

## File Structure

```
scripts/pipeline/
  __init__.py        empty; makes the package importable from repo root
  config.py          paths, dataset/resource ids, tile list, gates, CRS codes
  glbtool.py         ring cleaning, Newell basis, earcut, CityJSON→glb, report
  convert.py         strip_appearance + citygml-tools subprocess wrapper
  portal.py          CKAN resource → signed GCS URL, resumable download, unpack
  reproject.py       EPSG:2950→4326, tiles-manifest.json + attributes sidecars
  preview.py         top-down height-colored PNG per glb
  run_vm.py          orchestrator for VM01–VM06
  tests/
    conftest.py      repo-root sys.path + fixture loaders
    fixtures/mini.city.json        2 buildings, 1 malformed ring, 1 degenerate
    fixtures/mini_textured.city.json  same + appearance block
    test_rings.py  test_glb.py  test_convert.py  test_portal.py  test_reproject.py
public/tiles/buildings/vm/       generated: VM01..06_2020.glb, VM0N_attributes.json,
                                 tiles-manifest.json   (committed in Task 8)
```

---

### Task 1: Package skeleton and config

**Files:**
- Create: `scripts/pipeline/__init__.py`, `scripts/pipeline/config.py`
- Test: `scripts/pipeline/tests/conftest.py`, `scripts/pipeline/tests/test_config.py`

**Interfaces:**
- Consumes: nothing
- Produces: `config.REPO_ROOT: Path`, `config.DATA: Path`, `config.VENV_PY: Path`, `config.CITYGML_TOOLS: Path`, `config.JAVA_HOME: str`, `config.OUT_DIR: Path`, `config.TILES: list[str]`, `config.VM_PACK_RESOURCE: str`, `config.VM_PACK_SIZE: int`, `config.SKIP_RATE_MAX: float`, `config.GLB_SIZE_MAX_MB: float`, `config.EPSG_SRC: int`, `config.PORTAL: str`

- [ ] **Step 1: Write the failing test**

`scripts/pipeline/tests/conftest.py`:

```python
import sys
from pathlib import Path

# repo root = four parents up from this file (tests -> pipeline -> scripts -> root)
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).parent / "fixtures"
```

`scripts/pipeline/tests/test_config.py`:

```python
from scripts.pipeline import config


def test_paths_anchor_on_repo_root():
    assert (config.REPO_ROOT / "scripts" / "pipeline").is_dir()
    assert config.OUT_DIR == config.REPO_ROOT / "public" / "tiles" / "buildings" / "vm"


def test_tiles_and_gates():
    assert config.TILES == ["VM01", "VM02", "VM03", "VM04", "VM05", "VM06"]
    assert 0 < config.SKIP_RATE_MAX <= 0.02
    assert config.EPSG_SRC == 2950
    assert config.VM_PACK_SIZE == 2534146301
```

- [ ] **Step 2: Run test to verify it fails**

Run (from the worktree root): `data/tools/cjenv312/bin/python -m pytest scripts/pipeline/tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.pipeline'` (or missing attributes)

Note: the venv lives under the **main checkout's** `data/`; from the worktree, call it by absolute path `"/Users/nickv/ClaudeCode Projects/MyCityVisualization/data/tools/cjenv312/bin/python"`. Every `Run:` line below means that interpreter.

- [ ] **Step 3: Write the implementation**

`scripts/pipeline/__init__.py`: empty file.

`scripts/pipeline/config.py`:

```python
from pathlib import Path

# Repo root when run from either the main checkout or a linked worktree:
# this file sits at <root>/scripts/pipeline/config.py.
REPO_ROOT = Path(__file__).resolve().parents[2]

# Heavy data lives in the MAIN checkout's gitignored data/ (shared across worktrees).
MAIN_CHECKOUT = Path("/Users/nickv/ClaudeCode Projects/MyCityVisualization")
DATA = MAIN_CHECKOUT / "data"
RAW = DATA / "raw"
TILES_DIR = DATA / "tiles"
VENV_PY = DATA / "tools" / "cjenv312" / "bin" / "python"
CITYGML_TOOLS = DATA / "tools" / "citygml-tools-2.5.0" / "citygml-tools"
JAVA_HOME = "/opt/homebrew/opt/openjdk"

# Web assets are written into THIS checkout (worktree) and committed.
OUT_DIR = REPO_ROOT / "public" / "tiles" / "buildings" / "vm"

PORTAL = "https://donnees.montreal.ca"
DATASET_2020 = "batiments-3d-2020-maquette-lod2-avec-textures"
VM_PACK_RESOURCE = "7bff216d-bf3f-4c90-8677-2aceca08a360"   # vm_2020_gml_01_06.zip
VM_PACK_NAME = "vm_2020_gml_01_06.zip"
VM_PACK_SIZE = 2534146301
TILES = ["VM01", "VM02", "VM03", "VM04", "VM05", "VM06"]

SKIP_RATE_MAX = 0.02      # spec §3: fail a tile above this sanitizer skip rate
GLB_SIZE_MAX_MB = 15.0    # spec §9: stop for a compression decision above this
EPSG_SRC = 2950           # NAD83(CSRS) / MTM zone 8 — undeclared in source files
ATTRIBUTION = "Ville de Montréal"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest scripts/pipeline/tests/test_config.py -v` → Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/__init__.py scripts/pipeline/config.py scripts/pipeline/tests/
git commit -m "feat(pipeline): package skeleton and config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Ring cleaning and surface triangulation (pure core)

**Files:**
- Create: `scripts/pipeline/glbtool.py` (pure functions only in this task)
- Test: `scripts/pipeline/tests/test_rings.py`

**Interfaces:**
- Consumes: numpy, mapbox_earcut
- Produces:
  - `clean_ring(indices: list[int]) -> list[int]` — collapse consecutive duplicates, drop closing repeat
  - `newell_basis(pts: "np.ndarray(n,3)") -> tuple | None` — `(u, v)` unit vectors spanning the surface plane, `None` for zero-area
  - `triangulate_surface(rings: list[list[int]], verts: "np.ndarray(N,3)") -> tuple[list, str | None]` — `(faces, skip_reason)`; `faces` are `[i,j,k]` global-index triples; `skip_reason ∈ {None, "degenerate_ring", "no_normal", "earcut_empty"}`

- [ ] **Step 1: Write the failing tests**

`scripts/pipeline/tests/test_rings.py`:

```python
import numpy as np

from scripts.pipeline.glbtool import clean_ring, newell_basis, triangulate_surface


def test_clean_ring_collapses_duplicates_and_closing_vertex():
    assert clean_ring([8, 9, 9, 13, 12, 8]) == [8, 9, 13, 12]
    assert clean_ring([0, 1, 2]) == [0, 1, 2]
    assert clean_ring([5, 5, 5]) == [5]


def test_newell_basis_handles_vertical_walls():
    wall = np.array([[0, 0, 0], [1, 0, 0], [1, 0, 3], [0, 0, 3]], float)
    basis = newell_basis(wall)
    assert basis is not None
    u, v = basis
    assert abs(np.dot(u, v)) < 1e-9


def test_newell_basis_rejects_zero_area():
    line = np.array([[0, 0, 0], [1, 0, 0], [2, 0, 0]], float)
    assert newell_basis(line) is None


def test_triangulate_square_with_hole():
    verts = np.array(
        [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0],
         [1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]], float)
    faces, skip = triangulate_surface([[0, 1, 2, 3], [4, 5, 6, 7]], verts)
    assert skip is None
    assert len(faces) == 8  # square with square hole = 8 triangles


def test_triangulate_degenerate_ring_is_skipped_with_reason():
    verts = np.array([[0, 0, 0], [1, 0, 0]], float)
    faces, skip = triangulate_surface([[0, 1, 0]], verts)
    assert faces == [] and skip == "degenerate_ring"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest scripts/pipeline/tests/test_rings.py -v`
Expected: FAIL — `ImportError` (module doesn't exist yet)

- [ ] **Step 3: Write the implementation**

`scripts/pipeline/glbtool.py`:

```python
"""CityJSON -> glb core. Pure geometry helpers + (Task 3) tile converter.

Sanitizes Rhinocity export quirks explicitly: consecutive duplicate ring
vertices, closing-vertex repetition, degenerate (<3 unique vertex) rings,
zero-area surfaces. Skips are counted and reported, never silent.
"""
import numpy as np
import mapbox_earcut


def clean_ring(indices):
    out = []
    for i in indices:
        if not out or i != out[-1]:
            out.append(i)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def newell_basis(pts):
    n = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n += np.cross(a, b)
    ln = np.linalg.norm(n)
    if ln < 1e-12:
        return None
    n /= ln
    u = np.cross(n, [0.0, 0.0, 1.0])
    if np.linalg.norm(u) < 1e-9:
        u = np.cross(n, [0.0, 1.0, 0.0])
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    return u, v


def triangulate_surface(rings, verts):
    rings = [clean_ring(r) for r in rings]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return [], "degenerate_ring"
    basis = newell_basis(verts[rings[0]])
    if basis is None:
        return [], "no_normal"
    u, v = basis
    flat = np.concatenate(rings)
    pts3 = verts[flat]
    pts2 = np.column_stack([pts3 @ u, pts3 @ v])
    ring_ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    tri = mapbox_earcut.triangulate_float64(pts2, ring_ends)
    if len(tri) == 0:
        return [], "earcut_empty"
    return [flat[t].tolist() for t in np.asarray(tri).reshape(-1, 3)], None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest scripts/pipeline/tests/test_rings.py -v` → Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/glbtool.py scripts/pipeline/tests/test_rings.py
git commit -m "feat(pipeline): ring cleaning and earcut triangulation core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Tile converter with skip gate and roundtrip test

**Files:**
- Modify: `scripts/pipeline/glbtool.py` (append converter; keep Task 2 functions unchanged)
- Create: `scripts/pipeline/tests/fixtures/mini.city.json`
- Test: `scripts/pipeline/tests/test_glb.py`

**Interfaces:**
- Consumes: Task 2 functions; `config.SKIP_RATE_MAX`; trimesh
- Produces:
  - `class PipelineError(RuntimeError)`
  - `convert_tile(geom_json: Path, glb_out: Path) -> dict` — report `{"tile", "buildings", "triangles", "skipped": {reason: int}, "surfaces", "skip_rate", "anchor_mtm8": [E, N, h], "glb_bytes"}`; raises `PipelineError` if `skip_rate > SKIP_RATE_MAX`. Output glb: one named node per building (name = CityObject id), recentered to `geographicalExtent` min corner, Y-up (`(E,N,h) → (E,h,−N)`).

- [ ] **Step 1: Create the fixture**

`scripts/pipeline/tests/fixtures/mini.city.json` — two 2×2×3 m cube buildings; building `B2` has one ring with duplicate+closing vertices (cleans to valid) and one extra degenerate ring surface:

```json
{"type":"CityJSON","version":"2.0",
 "transform":{"scale":[1.0,1.0,1.0],"translate":[0.0,0.0,0.0]},
 "metadata":{"geographicalExtent":[0.0,0.0,0.0,7.0,2.0,3.0]},
 "vertices":[[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,3],[2,0,3],[2,2,3],[0,2,3],
             [5,0,0],[7,0,0],[7,2,0],[5,2,0],[5,0,3],[7,0,3],[7,2,3],[5,2,3]],
 "CityObjects":{
  "B1":{"type":"Building","attributes":{"measuredHeight":3.0,"Volume":12.0,"parcelle":"P-1"},
    "geometry":[{"type":"Solid","lod":"2","boundaries":[[
      [[3,2,1,0]],[[4,5,6,7]],[[0,1,5,4]],[[1,2,6,5]],[[2,3,7,6]],[[3,0,4,7]]]]}]},
  "B2":{"type":"Building","attributes":{"measuredHeight":3.0,"Volume":12.0,"parcelle":" "},
    "geometry":[{"type":"Solid","lod":"2","boundaries":[[
      [[11,10,9,8]],[[12,13,14,15]],[[8,9,9,13,12,8]],[[9,10,14,13]],[[10,11,15,14]],[[11,8,12,15]],[[8,9,8]]]]}]}}}
```

- [ ] **Step 2: Write the failing test**

`scripts/pipeline/tests/test_glb.py`:

```python
import json

import pytest
import trimesh

from scripts.pipeline.glbtool import PipelineError, convert_tile
from .conftest import FIXTURES


def test_convert_tile_roundtrip(tmp_path):
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest scripts/pipeline/tests/test_glb.py -v`
Expected: FAIL — `ImportError: cannot import name 'convert_tile'`

- [ ] **Step 4: Write the implementation (append to `glbtool.py`)**

```python
import json
from pathlib import Path

import trimesh

from scripts.pipeline.config import SKIP_RATE_MAX


class PipelineError(RuntimeError):
    pass


def convert_tile(geom_json, glb_out):
    geom_json, glb_out = Path(geom_json), Path(glb_out)
    d = json.loads(geom_json.read_text())
    tr = d["transform"]
    verts = np.asarray(d["vertices"], float) * tr["scale"] + tr["translate"]

    ext = d["metadata"]["geographicalExtent"]
    anchor = np.array([ext[0], ext[1], ext[2]])
    local = verts - anchor
    local = np.column_stack([local[:, 0], local[:, 2], -local[:, 1]])  # Y-up

    skipped = {"degenerate_ring": 0, "no_normal": 0, "earcut_empty": 0}
    surfaces = 0
    meshes = {}
    for oid, obj in d["CityObjects"].items():
        faces = []
        for geom in obj.get("geometry", []):
            shells = geom["boundaries"] if geom["type"] == "Solid" else [geom["boundaries"]]
            for shell in shells:
                for surface in shell:
                    surfaces += 1
                    tri, skip = triangulate_surface(surface, local)
                    if skip:
                        skipped[skip] += 1
                    else:
                        faces.extend(tri)
        if faces:
            m = trimesh.Trimesh(vertices=local, faces=np.asarray(faces), process=True)
            m.fix_normals()
            meshes[str(oid)] = m

    rate = (sum(skipped.values()) / surfaces) if surfaces else 0.0
    if rate > SKIP_RATE_MAX:
        raise PipelineError(
            f"{geom_json.name}: skip rate {rate:.1%} exceeds {SKIP_RATE_MAX:.0%} ({skipped})")

    glb_out.parent.mkdir(parents=True, exist_ok=True)
    trimesh.Scene(meshes).export(glb_out)
    return {
        "tile": geom_json.stem.split("_")[0],
        "buildings": len(meshes),
        "triangles": int(sum(len(m.faces) for m in meshes.values())),
        "skipped": skipped,
        "surfaces": surfaces,
        "skip_rate": rate,
        "anchor_mtm8": anchor.tolist(),
        "glb_bytes": glb_out.stat().st_size,
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest scripts/pipeline/tests/test_glb.py scripts/pipeline/tests/test_rings.py -v` → Expected: 7 passed

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/glbtool.py scripts/pipeline/tests/
git commit -m "feat(pipeline): CityJSON to glb converter with skip gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Appearance strip and citygml-tools wrapper

**Files:**
- Create: `scripts/pipeline/convert.py`, `scripts/pipeline/tests/fixtures/mini_textured.city.json`
- Test: `scripts/pipeline/tests/test_convert.py`

**Interfaces:**
- Consumes: `config.CITYGML_TOOLS`, `config.JAVA_HOME`
- Produces:
  - `strip_appearance(src: Path, dst: Path) -> int` — returns count of removed texture/material refs; also drops top-level `"appearance"`
  - `gml_to_cityjson(gml: Path) -> Path` — runs citygml-tools `to-cityjson`, returns the `.json` path it wrote (same stem, same dir); raises `PipelineError` on nonzero exit

- [ ] **Step 1: Create the fixture**

`scripts/pipeline/tests/fixtures/mini_textured.city.json` — copy `mini.city.json` and (a) add after `"version":"2.0",` a fake appearance block `"appearance":{"textures":[{"type":"JPG","image":"appearance/x.jpg"}]},` (b) inside **B1**'s geometry object, after `"lod":"2",` add `"texture":{"rhinocity":{"values":[[[0]]]}},`.

- [ ] **Step 2: Write the failing tests**

`scripts/pipeline/tests/test_convert.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest scripts/pipeline/tests/test_convert.py -v`
Expected: FAIL — no module `scripts.pipeline.convert`

- [ ] **Step 4: Write the implementation**

`scripts/pipeline/convert.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest scripts/pipeline/tests/test_convert.py -v` → Expected: 2 passed
(The `--version` test exercises the real Java toolchain — if it fails, fix `JAVA_HOME`/tool paths before proceeding; nothing downstream works without them.)

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/convert.py scripts/pipeline/tests/
git commit -m "feat(pipeline): appearance strip and citygml-tools wrapper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Portal fetch — signed URL, resumable download, nested unpack

**Files:**
- Create: `scripts/pipeline/portal.py`
- Test: `scripts/pipeline/tests/test_portal.py`

**Interfaces:**
- Consumes: `config.PORTAL`, `config.DATASET_2020`, curl (subprocess), urllib
- Produces:
  - `resource_url(resource_id: str, filename: str) -> str` — portal `/download/` URL
  - `resolve_signed_url(url: str) -> str` — HEAD without redirect-following; returns `Location` header; raises `PipelineError` if absent
  - `download(url: str, dest: Path, expected_size: int | None) -> None` — curl `-fSL -C -`; verifies final byte size when `expected_size` given, raises `PipelineError` on mismatch; no-op if `dest` already has `expected_size`
  - `unpack_inner(outer_zip: Path, inner_name: str, work_dir: Path) -> Path` — extracts `<inner_name>` from the outer zip, then extracts that inner zip into `work_dir/<tile>/`; returns tile dir; no-op if the `.gml` already exists

- [ ] **Step 1: Write the failing tests** (pure parts only; network functions carry `@pytest.mark.network` and are excluded by default)

`scripts/pipeline/tests/test_portal.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest scripts/pipeline/tests/test_portal.py -v` → Expected: FAIL (no module)

- [ ] **Step 3: Write the implementation**

`scripts/pipeline/portal.py`:

```python
import subprocess
import urllib.request
import zipfile
from pathlib import Path

from scripts.pipeline.config import DATASET_2020, PORTAL
from scripts.pipeline.glbtool import PipelineError


def resource_url(resource_id, filename):
    return f"{PORTAL}/dataset/{DATASET_2020}/resource/{resource_id}/download/{filename}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def resolve_signed_url(url):
    req = urllib.request.Request(url, method="HEAD")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        opener.open(req, timeout=30)
        raise PipelineError(f"expected a redirect from {url}, got 200")
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location")
        if e.code in (301, 302, 303, 307, 308) and loc:
            return loc
        raise PipelineError(f"no signed-URL redirect from {url}: HTTP {e.code}")


def verify_size(path, expected):
    actual = Path(path).stat().st_size
    if actual != expected:
        raise PipelineError(f"{path}: {actual} bytes, expected {expected}")


def download(url, dest, expected_size=None):
    dest = Path(dest)
    if expected_size and dest.exists() and dest.stat().st_size == expected_size:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["curl", "-fSL", "-C", "-", "--retry", "3", "-o", str(dest), url],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise PipelineError(f"download failed: {r.stderr[-300:]}")
    if expected_size:
        verify_size(dest, expected_size)


def unpack_inner(outer_zip, inner_name, work_dir):
    tile = inner_name.split("_")[0]
    tile_dir = Path(work_dir) / tile
    if list(tile_dir.glob("*.gml")):
        return tile_dir
    tile_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(outer_zip) as z:
        inner_path = Path(z.extract(inner_name, tile_dir))
    with zipfile.ZipFile(inner_path) as z:
        z.extractall(tile_dir)
    inner_path.unlink()
    return tile_dir
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest scripts/pipeline/tests/test_portal.py -v` → Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/portal.py scripts/pipeline/tests/test_portal.py
git commit -m "feat(pipeline): portal fetch with signed-URL workaround

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Reprojection, tiles manifest, attribute sidecars

**Files:**
- Create: `scripts/pipeline/reproject.py`
- Test: `scripts/pipeline/tests/test_reproject.py`

**Interfaces:**
- Consumes: pyproj; Task 3 report dicts; `config.EPSG_SRC`, `config.ATTRIBUTION`, `config.OUT_DIR`
- Produces:
  - `to_wgs84(e: float, n: float) -> tuple[float, float]` — `(lng, lat)`
  - `extent_wgs84(ext: list[float]) -> list[float]` — `[w, s, e, n]` from a 6-float CityJSON `geographicalExtent`
  - `write_attributes_sidecar(geom_json: Path, out_json: Path) -> int` — `{buildingId: attributes}` map; returns building count
  - `build_manifest(reports: list[dict], extents: dict[str, list[float]]) -> dict` — `{"version": 1, "license": "CC-BY-4.0", "attribution", "crsSource": "EPSG:2950", "tiles": [{"id", "path", "anchorMtm8", "anchor", "buildingsCount", "trianglesCount", "extentWgs84"}]}`; tile `path` is `/tiles/buildings/vm/<TILE>_2020.glb`

- [ ] **Step 1: Write the failing tests**

`scripts/pipeline/tests/test_reproject.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest scripts/pipeline/tests/test_reproject.py -v` → Expected: FAIL (no module)

- [ ] **Step 3: Write the implementation**

`scripts/pipeline/reproject.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest scripts/pipeline/tests/test_reproject.py -v` → Expected: 4 passed
(First run also confirms `pyproj` is installed in the venv; if not: `data/tools/cjenv312/bin/pip install pyproj` and add it to Task 8's bootstrap notes.)

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/reproject.py scripts/pipeline/tests/test_reproject.py
git commit -m "feat(pipeline): WGS84 reprojection, manifest, attribute sidecars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Preview renderer

**Files:**
- Create: `scripts/pipeline/preview.py`
- Test: `scripts/pipeline/tests/test_preview.py`

**Interfaces:**
- Consumes: trimesh, matplotlib (Agg); a glb from `convert_tile`
- Produces: `render_preview(glb: Path, png: Path, title: str) -> None` — top-down, height-colored PNG on dark background

- [ ] **Step 1: Write the failing test**

`scripts/pipeline/tests/test_preview.py`:

```python
from scripts.pipeline.glbtool import convert_tile
from scripts.pipeline.preview import render_preview
from .conftest import FIXTURES


def test_preview_renders_png(tmp_path):
    glb = tmp_path / "mini.glb"
    convert_tile(FIXTURES / "mini.city.json", glb)
    png = tmp_path / "mini.png"
    render_preview(glb, png, "mini")
    assert png.stat().st_size > 1000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest scripts/pipeline/tests/test_preview.py -v` → Expected: FAIL (no module)

- [ ] **Step 3: Write the implementation**

`scripts/pipeline/preview.py`:

```python
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from matplotlib.collections import PolyCollection

BG = "#0e1117"


def render_preview(glb, png, title):
    sc = trimesh.load(glb)
    polys, hs = [], []
    for g in sc.geometry.values():
        tri = g.vertices[g.faces]                      # glTF Y-up
        e, n, h = tri[:, :, 0], -tri[:, :, 2], tri[:, :, 1].mean(axis=1)
        polys.append(np.stack([e, n], axis=-1))
        hs.append(h)
    pl, h = np.concatenate(polys), np.concatenate(hs)
    fig, ax = plt.subplots(figsize=(8, 8), dpi=140)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    pc = PolyCollection(pl, array=h, cmap="magma", lw=0)
    ax.add_collection(pc)
    ax.autoscale()
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(f"{title} — height (m)", color="w", fontsize=9)
    fig.colorbar(pc, ax=ax, shrink=0.5).ax.tick_params(colors="w", labelsize=7)
    plt.savefig(png, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest scripts/pipeline/tests/test_preview.py -v` → Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/preview.py scripts/pipeline/tests/test_preview.py
git commit -m "feat(pipeline): top-down preview renderer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Orchestrator and the full Ville-Marie run

**Files:**
- Create: `scripts/pipeline/run_vm.py`
- Test: full pytest suite + the real six-tile run (this task's "test" is the production run itself)

**Interfaces:**
- Consumes: every prior module
- Produces: `public/tiles/buildings/vm/{VM01..VM06}_2020.glb`, `{VM01..VM06}_attributes.json`, `tiles-manifest.json`, previews in `data/previews/`, and a printed per-tile report table

- [ ] **Step 1: Write the orchestrator**

`scripts/pipeline/run_vm.py`:

```python
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
```

- [ ] **Step 2: Run the full unit suite first**

Run: `pytest scripts/pipeline/tests -v` → Expected: all pass (13 tests)

- [ ] **Step 3: Verify license before publishing assets**

Run: `curl -s "https://donnees.montreal.ca/api/3/action/package_show?id=batiments-3d-2020-maquette-lod2-avec-textures" | python3 -c "import json,sys; d=json.load(sys.stdin)['result']; print(d.get('license_title'), d.get('license_url'))"`
Expected: a CC BY 4.0 license. If it is anything else, STOP and surface to Nick before committing assets (manifest hardcodes `CC-BY-4.0`).

- [ ] **Step 4: Run the pipeline**

Run: `data/tools/cjenv312/bin/python -m scripts.pipeline.run_vm` (from the worktree root; VM06 reuses cached artifacts, VM01–05 convert fresh — expect several minutes each for citygml-tools on the bigger tiles)
Expected: six report lines, `OK: all tiles within size gate.` — or a SIZE GATE stop, which ends this task at a decision point (report to Nick; do not commit).

- [ ] **Step 5: Eyeball every preview**

Open the six PNGs in `data/previews/`. Each must look like coherent urban fabric (blocks, streets); any scrambled tile = stop and investigate before committing.

- [ ] **Step 6: Commit assets and orchestrator, push, report**

```bash
git add scripts/pipeline/run_vm.py public/tiles/buildings/vm/
git commit -m "feat(pipeline): orchestrator + six Ville-Marie geometry tiles and manifest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Then report the per-tile table and total asset size in the PR (#1) conversation, attach the six previews for Nick, and mark Phase A complete. Phase B (the `src/layers/buildings` module) starts only after the foundation session's Plan 1 lands — write its own plan then.

---

## Self-Review (completed)

- **Spec coverage:** §2 fetch quirk → Task 5; §3 steps 1–5 → Tasks 5/4/4/3/6; skip gate → Task 3; §4 hosting paths → Tasks 6/8; §7 pipeline tests → Tasks 2–7 (golden bounds + roundtrip in Task 6); §9 size gate → Task 8; license check → Task 8 Step 3; attribute survival (§1) → sidecars, deviation recorded in Global Constraints. Layer-module sections (§5, §6 client rows, Vitest/Playwright) are Phase B — explicitly out of scope here.
- **Placeholder scan:** none — every step carries runnable code, fixtures inline, exact commands and expected outputs.
- **Type consistency:** `convert_tile` report keys match `build_manifest` consumption (`tile`, `buildings`, `triangles`, `anchor_mtm8`, `glb_bytes`); `PipelineError` defined once (Task 3), imported elsewhere; `verify_size` produced (Task 5) and tested; fixture ids `B1`/`B2` consistent across Tasks 3/6.
