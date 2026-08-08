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
