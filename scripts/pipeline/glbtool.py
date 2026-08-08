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


# Task 3: Tile converter with skip gate
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
