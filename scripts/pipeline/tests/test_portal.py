import http.server
import socket
import threading
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import pytest

from scripts.pipeline.glbtool import PipelineError
from scripts.pipeline.portal import download, resolve_signed_url, resource_url, unpack_inner, verify_size


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


class _TestHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler for loopback tests."""

    response_code = 200
    response_location = None

    def do_HEAD(self):
        if self.response_code in (301, 302, 303, 307, 308):
            self.send_response(self.response_code)
            if self.response_location:
                self.send_header("Location", self.response_location)
            self.end_headers()
        else:
            self.send_response(self.response_code)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress logging


def _find_free_port():
    """Find a port that's definitely closed."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def test_resolve_signed_url_302_with_location():
    """Test 302 redirect with Location header returns the location."""
    port = _find_free_port()
    _TestHandler.response_code = 302
    _TestHandler.response_location = "https://storage.googleapis.com/signed/url"

    server = http.server.HTTPServer(("127.0.0.1", port), _TestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        url = f"http://127.0.0.1:{port}/test"
        result = resolve_signed_url(url)
        assert result == "https://storage.googleapis.com/signed/url"
    finally:
        server.shutdown()


def test_resolve_signed_url_302_without_location():
    """Test 302 without Location header raises PipelineError."""
    port = _find_free_port()
    _TestHandler.response_code = 302
    _TestHandler.response_location = None

    server = http.server.HTTPServer(("127.0.0.1", port), _TestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        url = f"http://127.0.0.1:{port}/test"
        with pytest.raises(PipelineError) as exc_info:
            resolve_signed_url(url)
        assert "no signed-URL redirect" in str(exc_info.value)
    finally:
        server.shutdown()


def test_resolve_signed_url_200_raises():
    """Test 200 response raises PipelineError."""
    port = _find_free_port()
    _TestHandler.response_code = 200
    _TestHandler.response_location = None

    server = http.server.HTTPServer(("127.0.0.1", port), _TestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        url = f"http://127.0.0.1:{port}/test"
        with pytest.raises(PipelineError) as exc_info:
            resolve_signed_url(url)
        assert "expected a redirect" in str(exc_info.value)
    finally:
        server.shutdown()


def test_resolve_signed_url_connection_refused():
    """Test connection to closed port raises PipelineError."""
    closed_port = _find_free_port()
    url = f"http://127.0.0.1:{closed_port}/test"

    with pytest.raises(PipelineError) as exc_info:
        resolve_signed_url(url)
    assert "cannot reach portal" in str(exc_info.value)


def test_download_noop_when_exists(tmp_path):
    """Test download returns without error when file exists with expected size."""
    dest = tmp_path / "existing.bin"
    dest.write_bytes(b"x" * 100)

    # Should return without attempting to download from an unreachable URL
    download("http://127.0.0.1:1/unreachable", dest, expected_size=100)
    assert dest.stat().st_size == 100
