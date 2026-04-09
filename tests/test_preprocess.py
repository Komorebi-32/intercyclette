"""
Unit tests for scripts.preprocess.

Tests use synthetic data and temp files to avoid dependency on real GPX/GeoJSON
files or persistent disk state.
"""

import json
import os
import tempfile
import pytest

# scripts/preprocess.py is not a package, import via sys.path insertion
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.preprocess import (
    write_index,
    load_existing_index,
    build_route_stations_index,
)
from app.geo.gpx_parser import GPX_NAMESPACE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gpx_file(points: list[tuple[float, float]], name: str = "Test") -> str:
    """Write a minimal GPX temp file and return its path."""
    pts_xml = "\n".join(
        f'      <trkpt lat="{lat}" lon="{lon}"><ele>100</ele></trkpt>'
        for lat, lon in points
    )
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="{GPX_NAMESPACE}" version="1.1">
  <trk><name>{name}</name><trkseg>{pts_xml}</trkseg></trk>
</gpx>"""
    fd, path = tempfile.mkstemp(suffix=".gpx")
    with os.fdopen(fd, "w") as f:
        f.write(xml)
    return path


def _make_geojson_file(stations: list[dict]) -> str:
    """Write a GeoJSON FeatureCollection temp file and return its path."""
    data = {"type": "FeatureCollection", "features": stations}
    fd, path = tempfile.mkstemp(suffix=".geojson")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return path


def _station_feature(nom: str, lat: float, lon: float, uic: str = "87000001") -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {"nom": nom, "libellecourt": nom[:3].upper(), "codes_uic": uic},
    }


# ---------------------------------------------------------------------------
# write_index
# ---------------------------------------------------------------------------

class TestWriteIndex:
    def test_creates_file(self, tmp_path):
        output = str(tmp_path / "sub" / "out.json")
        write_index({"key": "value"}, output)
        assert os.path.isfile(output)

    def test_creates_parent_directories(self, tmp_path):
        output = str(tmp_path / "a" / "b" / "c" / "out.json")
        write_index({"x": 1}, output)
        assert os.path.isfile(output)

    def test_content_is_valid_json(self, tmp_path):
        output = str(tmp_path / "out.json")
        data = {"routes": {"EV15": {"name": "Test"}}}
        write_index(data, output)
        with open(output) as f:
            loaded = json.load(f)
        assert loaded == data

    def test_unicode_preserved(self, tmp_path):
        output = str(tmp_path / "out.json")
        write_index({"name": "Véloroute du Rhin"}, output)
        with open(output, encoding="utf-8") as f:
            content = f.read()
        assert "Véloroute du Rhin" in content


# ---------------------------------------------------------------------------
# load_existing_index
# ---------------------------------------------------------------------------

class TestLoadExistingIndex:
    def test_returns_none_if_file_absent(self, tmp_path):
        result = load_existing_index(str(tmp_path / "nonexistent.json"))
        assert result is None

    def test_returns_dict_if_file_exists(self, tmp_path):
        path = str(tmp_path / "index.json")
        data = {"routes": {}}
        with open(path, "w") as f:
            json.dump(data, f)
        result = load_existing_index(path)
        assert result == data

    def test_returns_none_for_invalid_json(self, tmp_path):
        path = str(tmp_path / "bad.json")
        with open(path, "w") as f:
            f.write("NOT JSON")
        result = load_existing_index(path)
        assert result is None


# ---------------------------------------------------------------------------
# build_route_stations_index (integration-style with synthetic data)
# ---------------------------------------------------------------------------

class TestBuildRouteStationsIndex:
    def _setup_synthetic_data(self, tmp_path):
        """
        Create a minimal GPX dir, GeoJSON file, and monkeypatch EUROVELO_ROUTES.
        Returns (gpx_dir, geojson_path, output_path, gpx_file_path).
        """
        gpx_dir = str(tmp_path / "gpx")
        os.makedirs(gpx_dir)
        # A short north-south route near Paris
        gpx_path = os.path.join(gpx_dir, "test-route.gpx")
        _make_gpx_file([(48.0, 2.0), (49.0, 2.0)], name="Test Route")
        # Copy to target path
        import shutil
        actual_gpx = _make_gpx_file([(48.0, 2.0), (49.0, 2.0)], name="Test Route")
        shutil.copy(actual_gpx, gpx_path)
        os.unlink(actual_gpx)

        geojson_path = _make_geojson_file([
            _station_feature("On Route", 48.5, 2.0),
            _station_feature("Far Away", 48.5, 5.0),  # >5 km away
        ])
        output_path = str(tmp_path / "processed" / "route_stations.json")
        return gpx_dir, geojson_path, output_path, gpx_path

    def _patch_routes(self, monkeypatch, routes: dict) -> None:
        """Monkeypatch EUROVELO_ROUTES in the preprocess module's local namespace."""
        import scripts.preprocess as preprocess_mod
        monkeypatch.setattr(preprocess_mod, "EUROVELO_ROUTES", routes)

    def test_output_file_created(self, tmp_path, monkeypatch):
        gpx_dir, geojson_path, output_path, _ = self._setup_synthetic_data(tmp_path)
        self._patch_routes(monkeypatch, {"TST": {"name": "Test Route", "file": "test-route.gpx"}})
        build_route_stations_index(gpx_dir, geojson_path, output_path, 5.0)
        assert os.path.isfile(output_path)

    def test_output_has_generated_at(self, tmp_path, monkeypatch):
        gpx_dir, geojson_path, output_path, _ = self._setup_synthetic_data(tmp_path)
        self._patch_routes(monkeypatch, {"TST": {"name": "Test Route", "file": "test-route.gpx"}})
        index = build_route_stations_index(gpx_dir, geojson_path, output_path, 5.0)
        assert "generated_at" in index

    def test_nearby_station_included(self, tmp_path, monkeypatch):
        gpx_dir, geojson_path, output_path, _ = self._setup_synthetic_data(tmp_path)
        self._patch_routes(monkeypatch, {"TST": {"name": "Test Route", "file": "test-route.gpx"}})
        index = build_route_stations_index(gpx_dir, geojson_path, output_path, 5.0)
        stations = index["routes"]["TST"]["stations"]
        noms = [s["nom"] for s in stations]
        assert "On Route" in noms

    def test_far_station_excluded(self, tmp_path, monkeypatch):
        gpx_dir, geojson_path, output_path, _ = self._setup_synthetic_data(tmp_path)
        self._patch_routes(monkeypatch, {"TST": {"name": "Test Route", "file": "test-route.gpx"}})
        index = build_route_stations_index(gpx_dir, geojson_path, output_path, 5.0)
        stations = index["routes"]["TST"]["stations"]
        noms = [s["nom"] for s in stations]
        assert "Far Away" not in noms

    def test_missing_gpx_skipped_gracefully(self, tmp_path, monkeypatch):
        """Route with missing GPX file is skipped without crashing."""
        gpx_dir = str(tmp_path / "gpx")
        os.makedirs(gpx_dir)
        geojson_path = _make_geojson_file([_station_feature("Somewhere", 48.0, 2.0)])
        output_path = str(tmp_path / "out.json")
        self._patch_routes(monkeypatch, {"MISSING": {"name": "No File", "file": "missing.gpx"}})
        index = build_route_stations_index(gpx_dir, geojson_path, output_path, 5.0)
        # Route is absent from index (skipped), no exception raised
        assert "MISSING" not in index["routes"]
