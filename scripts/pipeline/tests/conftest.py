import sys
from pathlib import Path

# repo root = four parents up from this file (tests -> pipeline -> scripts -> root)
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).parent / "fixtures"
