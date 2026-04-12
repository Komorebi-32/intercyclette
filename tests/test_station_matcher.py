"""
Unit tests for app.geo.station_matcher.

All tests use synthetic data — no real GeoJSON or GPX files are read.
"""

import json
import os
import tempfile
import pytest

from app.geo.station_matcher import (
    parse_uic_codes,
    load_stations,
    closest_point_on_route_km,
    find_features_near_route,
    find_stations_near_route,
    serialize_route_stations,
    StationOnRoute,
)
from app.geo.gpx_parser import GpxTrack
from app.geo.distance import cumulative_distances_km


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_track(points: list[tuple[float, float]], route_id: str = "TST") -> GpxTrack:
    """Build a GpxTrack from a list of (lat, lon) points."""
    cum = cumulative_distances_km(points)
    return GpxTrack(
        route_id=route_id,
        name="Test Route",
        points=points,
        total_km=cum[-1],
    )


def _make_feature(nom: str, lat: float, lon: float, uic: str = "87000001") -> dict:
    """Build a minimal GeoJSON feature dict representing a station."""
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "nom": nom,
            "libellecourt": nom[:3].upper(),
            "codes_uic": uic,
        },
    }


def _write_geojson(features: list[dict]) -> str:
    """Write features to a temp GeoJSON file, return path."""
    data = {"type": "FeatureCollection", "features": features}
    fd, path = tempfile.mkstemp(suffix=".geojson")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return path


# ---------------------------------------------------------------------------
# parse_uic_codes
# ---------------------------------------------------------------------------

class TestParseUicCodes:
    def test_single_code(self):
        assert parse_uic_codes("87313759") == ["87313759"]

    def test_two_codes_semicolon_separated(self):
        assert parse_uic_codes("87318964;87756975") == ["87318964", "87756975"]

    def test_empty_string_returns_empty_list(self):
        assert parse_uic_codes("") == []

    def test_none_returns_empty_list(self):
        assert parse_uic_codes(None) == []

    def test_strips_whitespace_around_codes(self):
        assert parse_uic_codes(" 87001 ; 87002 ") == ["87001", "87002"]

    def test_trailing_semicolon_ignored(self):
        assert parse_uic_codes("87001;") == ["87001"]


# ---------------------------------------------------------------------------
# load_stations
# ---------------------------------------------------------------------------

class TestLoadStations:
    def test_returns_list_of_features(self):
        features = [_make_feature("Paris", 48.85, 2.35)]
        path = _write_geojson(features)
        try:
            result = load_stations(path)
            assert len(result) == 1
            assert result[0]["properties"]["nom"] == "Paris"
        finally:
            os.unlink(path)

    def test_file_not_found_raises(self):
        with pytest.raises(FileNotFoundError):
            load_stations("/tmp/does_not_exist_xyz.geojson")

    def test_not_feature_collection_raises(self):
        fd, path = tempfile.mkstemp(suffix=".geojson")
        with os.fdopen(fd, "w") as f:
            json.dump({"type": "Feature"}, f)
        try:
            with pytest.raises(ValueError, match="FeatureCollection"):
                load_stations(path)
        finally:
            os.unlink(path)

    def test_empty_features_raises(self):
        fd, path = tempfile.mkstemp(suffix=".geojson")
        with os.fdopen(fd, "w") as f:
            json.dump({"type": "FeatureCollection", "features": []}, f)
        try:
            with pytest.raises(ValueError):
                load_stations(path)
        finally:
            os.unlink(path)

    def test_multiple_stations_loaded(self):
        features = [
            _make_feature("Lyon", 45.76, 4.83),
            _make_feature("Marseille", 43.30, 5.37),
        ]
        path = _write_geojson(features)
        try:
            result = load_stations(path)
            assert len(result) == 2
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# closest_point_on_route_km
# ---------------------------------------------------------------------------

class TestClosestPointOnRouteKm:
    def test_station_on_route_returns_zero_distance(self):
        """Station at a track point returns distance ≈ 0."""
        polyline = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        cum = cumulative_distances_km(polyline)
        dist, _ = closest_point_on_route_km(49.0, 2.0, polyline, cum)
        assert dist == pytest.approx(0.0, abs=0.01)

    def test_cumulative_km_at_midpoint(self):
        """Station at track midpoint returns cumulative_km ≈ half total."""
        polyline = [(48.0, 2.0), (50.0, 2.0)]
        cum = cumulative_distances_km(polyline)
        _, cum_at = closest_point_on_route_km(49.0, 2.0, polyline, cum)
        # 49°N is approximately halfway between 48°N and 50°N along the route
        assert cum[0] < cum_at < cum[1]

    def test_station_off_route_returns_positive_distance(self):
        polyline = [(48.0, 2.0), (49.0, 2.0)]
        cum = cumulative_distances_km(polyline)
        dist, _ = closest_point_on_route_km(48.0, 3.0, polyline, cum)
        assert dist > 0.0

    def test_empty_polyline_raises(self):
        with pytest.raises(ValueError):
            closest_point_on_route_km(48.0, 2.0, [], [])

    def test_single_point_polyline(self):
        polyline = [(48.0, 2.0)]
        cum = cumulative_distances_km(polyline)
        dist, cum_at = closest_point_on_route_km(48.0, 2.0, polyline, cum)
        assert dist == pytest.approx(0.0, abs=0.01)
        assert cum_at == 0.0


# ---------------------------------------------------------------------------
# find_stations_near_route
# ---------------------------------------------------------------------------

class TestFindStationsNearRoute:
    def test_station_on_route_is_found(self):
        """Station sitting exactly on a track point is returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)])
        features = [_make_feature("On Route", 49.0, 2.0)]
        result = find_stations_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].nom == "On Route"

    def test_far_station_is_excluded(self):
        """Station > 5 km from route is not returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        # Station 1 degree east ≈ ~75 km away
        features = [_make_feature("Far Away", 48.5, 3.5)]
        result = find_stations_near_route(track, features, max_distance_km=5.0)
        assert result == []

    def test_results_sorted_by_cumulative_km(self):
        """Returned stations are sorted ascending by cumulative_km."""
        track = _make_track([(44.0, 2.0), (46.0, 2.0), (48.0, 2.0)])
        features = [
            _make_feature("North", 47.9, 2.0),
            _make_feature("South", 44.1, 2.0),
            _make_feature("Middle", 45.9, 2.0),
        ]
        result = find_stations_near_route(track, features, max_distance_km=20.0)
        cum_kms = [s.cumulative_km for s in result]
        assert cum_kms == sorted(cum_kms)

    def test_station_without_uic_is_skipped(self):
        """Feature with empty codes_uic is ignored."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [2.0, 48.5]},
                "properties": {"nom": "No UIC", "libellecourt": "NUC", "codes_uic": ""},
            }
        ]
        result = find_stations_near_route(track, features, max_distance_km=5.0)
        assert result == []

    def test_multiple_uic_codes_preserved(self):
        """Station with two UICs has both codes in codes_uic list."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_feature("Multi UIC", 48.5, 2.0, uic="87001;87002")]
        result = find_stations_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].codes_uic == ["87001", "87002"]

    def test_distance_to_route_stored_correctly(self):
        """distance_to_route_km is non-negative and reasonable."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_feature("Near", 48.5, 2.0)]
        result = find_stations_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].distance_to_route_km >= 0.0
        assert result[0].distance_to_route_km < 5.0

    def test_empty_station_list_returns_empty(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        result = find_stations_near_route(track, [], max_distance_km=5.0)
        assert result == []


# ---------------------------------------------------------------------------
# serialize_route_stations
# ---------------------------------------------------------------------------

class TestSerializeRouteStations:
    def test_output_has_required_keys(self):
        station = StationOnRoute(
            nom="Basel", libellecourt="BSL", codes_uic=["87321234"],
            lat=47.55, lon=7.59, distance_to_route_km=0.4, cumulative_km=0.0,
        )
        result = serialize_route_stations("EV15", "Véloroute du Rhin", 201.6, [station])
        assert result["route_id"] == "EV15"
        assert result["name"] == "Véloroute du Rhin"
        assert result["total_km"] == pytest.approx(201.6, abs=0.01)
        assert len(result["stations"]) == 1

    def test_empty_stations_list(self):
        result = serialize_route_stations("EV15", "Test", 100.0, [])
        assert result["stations"] == []

    def test_station_fields_serialized(self):
        station = StationOnRoute(
            nom="Basel", libellecourt="BSL", codes_uic=["87321234"],
            lat=47.55, lon=7.59, distance_to_route_km=0.4, cumulative_km=5.0,
        )
        result = serialize_route_stations("EV15", "Test", 100.0, [station])
        s = result["stations"][0]
        assert s["nom"] == "Basel"
        assert s["codes_uic"] == ["87321234"]
        assert s["cumulative_km"] == pytest.approx(5.0, abs=0.01)

    def test_output_is_json_serializable(self):
        """serialize_route_stations output must be JSON-serializable."""
        station = StationOnRoute(
            nom="Test", libellecourt="TST", codes_uic=["87000001"],
            lat=48.0, lon=2.0, distance_to_route_km=1.0, cumulative_km=10.0,
        )
        result = serialize_route_stations("TST", "Test Route", 50.0, [station])
        # Should not raise
        serialized = json.dumps(result)
        assert "Test" in serialized


# ---------------------------------------------------------------------------
# find_features_near_route
# ---------------------------------------------------------------------------

def _make_generic_feature(lat: float, lon: float, osm_id: str = "node/1") -> dict:
    """Build a minimal GeoJSON feature dict with Point geometry."""
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {"osm_id": osm_id, "name": "Test Point"},
    }


class TestFindFeaturesNearRoute:
    def test_feature_on_route_is_found(self):
        """Feature sitting exactly on a track point is returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)])
        features = [_make_generic_feature(49.0, 2.0, "node/1")]
        result = find_features_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0][0]["properties"]["osm_id"] == "node/1"

    def test_far_feature_is_excluded(self):
        """Feature > max_distance_km from route is not returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_generic_feature(48.5, 3.5, "node/2")]
        result = find_features_near_route(track, features, max_distance_km=5.0)
        assert result == []

    def test_results_sorted_by_cumulative_km(self):
        """Tuples are sorted ascending by the third element (cumulative_km)."""
        track = _make_track([(44.0, 2.0), (46.0, 2.0), (48.0, 2.0)])
        features = [
            _make_generic_feature(47.9, 2.0, "node/north"),
            _make_generic_feature(44.1, 2.0, "node/south"),
            _make_generic_feature(45.9, 2.0, "node/middle"),
        ]
        result = find_features_near_route(track, features, max_distance_km=20.0)
        cum_kms = [t[2] for t in result]
        assert cum_kms == sorted(cum_kms)

    def test_tuple_has_three_elements(self):
        """Each result tuple is (feature, distance_km, cumulative_km)."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_generic_feature(48.5, 2.0, "node/3")]
        result = find_features_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        feat, dist_km, cum_km = result[0]
        assert isinstance(feat, dict)
        assert dist_km >= 0.0
        assert cum_km >= 0.0

    def test_feature_missing_geometry_skipped(self):
        """Feature with missing or invalid geometry is silently skipped."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        bad_feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": []}, "properties": {}}
        result = find_features_near_route(track, [bad_feature], max_distance_km=5.0)
        assert result == []

    def test_empty_feature_list_returns_empty(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        result = find_features_near_route(track, [], max_distance_km=5.0)
        assert result == []
