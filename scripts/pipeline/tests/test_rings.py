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
