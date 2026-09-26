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
