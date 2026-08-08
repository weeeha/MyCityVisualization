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
