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
