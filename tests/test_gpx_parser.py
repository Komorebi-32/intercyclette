"""
Unit tests for app.geo.gpx_parser.

Tests use minimal in-memory XML strings to avoid dependency on real GPX files.
"""

import xml.etree.ElementTree as ET
import pytest
import tempfile
import os

from app.geo.gpx_parser import (
    extract_track_points,
    parse_gpx_file,
    GpxTrack,
    GPX_NS,
    GPX_NAMESPACE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gpx_xml(trkpts: list[tuple[float, float]], name: str = "Test Route") -> str:
    """Build a minimal valid GPX XML string with the given track points."""
    pts_xml = "\n".join(
        f'      <trkpt lat="{lat}" lon="{lon}"><ele>100</ele></trkpt>'
        for lat, lon in trkpts
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="{GPX_NAMESPACE}" version="1.1">
  <trk>
    <name>{name}</name>
    <trkseg>
{pts_xml}
    </trkseg>
  </trk>
</gpx>"""


def _write_temp_gpx(trkpts: list[tuple[float, float]], name: str = "Test Route") -> str:
    """Write a temp GPX file and return its path."""
    xml = _make_gpx_xml(trkpts, name)
    fd, path = tempfile.mkstemp(suffix=".gpx")
    with os.fdopen(fd, "w") as f:
        f.write(xml)
    return path


# ---------------------------------------------------------------------------
# extract_track_points
# ---------------------------------------------------------------------------

class TestExtractTrackPoints:
    def test_basic_two_points(self):
        """Two trkpt elements are returned as (lat, lon) tuples."""
        xml = _make_gpx_xml([(48.0, 2.0), (49.0, 3.0)])
        root = ET.fromstring(xml)
        points = extract_track_points(root, GPX_NS)
        assert points == [(48.0, 2.0), (49.0, 3.0)]

    def test_order_preserved(self):
        """Track points are returned in document order."""
        coords = [(44.0, -1.5), (45.0, -0.5), (46.0, 0.5)]
        xml = _make_gpx_xml(coords)
        root = ET.fromstring(xml)
        points = extract_track_points(root, GPX_NS)
        assert points == coords

    def test_empty_file_raises(self):
        """GPX with no trkpt elements raises ValueError."""
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="{GPX_NAMESPACE}" version="1.1"><trk><trkseg></trkseg></trk></gpx>"""
        root = ET.fromstring(xml)
        with pytest.raises(ValueError, match="No track points"):
            extract_track_points(root, GPX_NS)

    def test_float_precision_preserved(self):
        """High-precision float coordinates are parsed correctly."""
        xml = _make_gpx_xml([(47.591015, 7.593247999)])
        root = ET.fromstring(xml)
        points = extract_track_points(root, GPX_NS)
        assert points[0][0] == pytest.approx(47.591015, abs=1e-6)
        assert points[0][1] == pytest.approx(7.593247999, abs=1e-9)

    def test_many_points(self):
        """Can handle a large number of track points."""
        coords = [(48.0 + i * 0.001, 2.0 + i * 0.001) for i in range(1000)]
        xml = _make_gpx_xml(coords)
        root = ET.fromstring(xml)
        points = extract_track_points(root, GPX_NS)
        assert len(points) == 1000


# ---------------------------------------------------------------------------
# parse_gpx_file
# ---------------------------------------------------------------------------

class TestParseGpxFile:
    def test_returns_gpx_track(self):
        """Returns a GpxTrack dataclass instance."""
        path = _write_temp_gpx([(48.0, 2.0), (49.0, 2.0)])
        try:
            track = parse_gpx_file(path, "EV15")
            assert isinstance(track, GpxTrack)
        finally:
            os.unlink(path)

    def test_route_id_stored(self):
        """route_id matches the argument passed to parse_gpx_file."""
        path = _write_temp_gpx([(48.0, 2.0), (49.0, 2.0)])
        try:
            track = parse_gpx_file(path, "EV15")
            assert track.route_id == "EV15"
        finally:
            os.unlink(path)

    def test_track_name_extracted(self):
        """Name is read from <trk><name>."""
        path = _write_temp_gpx([(48.0, 2.0), (49.0, 2.0)], name="Véloroute du Rhin")
        try:
            track = parse_gpx_file(path, "EV15")
            assert track.name == "Véloroute du Rhin"
        finally:
            os.unlink(path)

    def test_points_populated(self):
        """Points list matches the track points in the file."""
        coords = [(44.0, -1.5), (45.0, -0.5), (46.0, 0.5)]
        path = _write_temp_gpx(coords)
        try:
            track = parse_gpx_file(path, "VEL")
            assert track.points == coords
        finally:
            os.unlink(path)

    def test_total_km_positive(self):
        """total_km is positive for a multi-point track."""
        path = _write_temp_gpx([(48.0, 2.0), (49.0, 2.0)])
        try:
            track = parse_gpx_file(path, "EV6")
            assert track.total_km > 0.0
        finally:
            os.unlink(path)

    def test_total_km_matches_haversine_sum(self):
        """total_km matches manually computed haversine sum."""
        from app.geo.distance import haversine_km
        coords = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        path = _write_temp_gpx(coords)
        try:
            track = parse_gpx_file(path, "EV6")
            expected = haversine_km(48.0, 2.0, 49.0, 2.0) + haversine_km(49.0, 2.0, 50.0, 2.0)
            assert track.total_km == pytest.approx(expected, abs=0.001)
        finally:
            os.unlink(path)

    def test_file_not_found_raises(self):
        """Non-existent file raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            parse_gpx_file("/tmp/does_not_exist_xyz.gpx", "EV15")

    def test_invalid_xml_raises(self):
        """Malformed XML raises ET.ParseError."""
        fd, path = tempfile.mkstemp(suffix=".gpx")
        with os.fdopen(fd, "w") as f:
            f.write("NOT XML AT ALL <<<")
        try:
            with pytest.raises(ET.ParseError):
                parse_gpx_file(path, "EV15")
        finally:
            os.unlink(path)

    def test_no_track_points_raises(self):
        """GPX with no trkpt elements raises ValueError."""
        xml = f"""<?xml version="1.0"?>
<gpx xmlns="{GPX_NAMESPACE}" version="1.1"><trk><trkseg></trkseg></trk></gpx>"""
        fd, path = tempfile.mkstemp(suffix=".gpx")
        with os.fdopen(fd, "w") as f:
            f.write(xml)
        try:
            with pytest.raises(ValueError):
                parse_gpx_file(path, "EV15")
        finally:
            os.unlink(path)
