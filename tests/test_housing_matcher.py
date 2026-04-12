"""
Unit tests for app.geo.housing_matcher.

All tests use synthetic data — no real GeoJSON or GPX files are read.
"""

import json
import os
import tempfile

import pytest

from app.geo.housing_matcher import (
    load_housing,
    find_housing_near_route,
    serialize_housing_points,
    HousingPoint,
)
from app.geo.gpx_parser import GpxTrack
from app.geo.distance import cumulative_distances_km


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_track(points: list[tuple[float, float]]) -> GpxTrack:
    """Build a GpxTrack from a list of (lat, lon) points."""
    cum = cumulative_distances_km(points)
    return GpxTrack(
        route_id="TST",
        name="Test Route",
        points=points,
        total_km=cum[-1],
    )


def _make_housing_feature(
    lat: float,
    lon: float,
    osm_id: str = "node/1",
    tourism: str | None = "hotel",
    name: str | None = "Hotel Test",
    website: str | None = "https://example.com",
    phone: str | None = "+33 1 23 45 67 89",
) -> dict:
    """Build a minimal GeoJSON feature dict representing a housing point."""
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "osm_id": osm_id,
            "tourism": tourism,
            "name": name,
            "website": website,
            "phone": phone,
        },
    }


def _write_geojson(features: list[dict]) -> str:
    """Write features to a temp GeoJSON file and return its path."""
    data = {"type": "FeatureCollection", "features": features}
    fd, path = tempfile.mkstemp(suffix=".geojson")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return path


# ---------------------------------------------------------------------------
# load_housing
# ---------------------------------------------------------------------------

class TestLoadHousing:
    def test_returns_list_of_features(self):
        features = [_make_housing_feature(48.0, 2.0)]
        path = _write_geojson(features)
        try:
            result = load_housing(path)
            assert len(result) == 1
            assert result[0]["properties"]["osm_id"] == "node/1"
        finally:
            os.unlink(path)

    def test_file_not_found_raises(self):
        with pytest.raises(FileNotFoundError):
            load_housing("/tmp/does_not_exist_xyz.geojson")

    def test_not_feature_collection_raises(self):
        fd, path = tempfile.mkstemp(suffix=".geojson")
        with os.fdopen(fd, "w") as f:
            json.dump({"type": "Feature"}, f)
        try:
            with pytest.raises(ValueError, match="FeatureCollection"):
                load_housing(path)
        finally:
            os.unlink(path)

    def test_empty_features_raises(self):
        fd, path = tempfile.mkstemp(suffix=".geojson")
        with os.fdopen(fd, "w") as f:
            json.dump({"type": "FeatureCollection", "features": []}, f)
        try:
            with pytest.raises(ValueError):
                load_housing(path)
        finally:
            os.unlink(path)

    def test_multiple_features_loaded(self):
        features = [
            _make_housing_feature(48.0, 2.0, osm_id="node/1"),
            _make_housing_feature(49.0, 2.0, osm_id="node/2"),
        ]
        path = _write_geojson(features)
        try:
            result = load_housing(path)
            assert len(result) == 2
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# find_housing_near_route
# ---------------------------------------------------------------------------

class TestFindHousingNearRoute:
    def test_point_on_route_is_found(self):
        """Housing point sitting exactly on a track point is returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)])
        features = [_make_housing_feature(49.0, 2.0, osm_id="node/10")]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].osm_id == "node/10"

    def test_far_point_is_excluded(self):
        """Housing point > max_distance_km from route is not returned."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 3.5, osm_id="node/11")]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert result == []

    def test_null_name_preserved_as_none(self):
        """Feature with null name property yields HousingPoint with name=None."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0, name=None)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].name is None

    def test_null_website_preserved_as_none(self):
        """Feature with null website property yields HousingPoint with website=None."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0, website=None)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].website is None

    def test_null_phone_preserved_as_none(self):
        """Feature with null phone property yields HousingPoint with phone=None."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0, phone=None)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].phone is None

    def test_null_tourism_preserved_as_none(self):
        """Feature with null tourism property yields HousingPoint with type=None."""
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0, tourism=None)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].type is None

    def test_empty_housing_list_returns_empty(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        result = find_housing_near_route(track, [], max_distance_km=5.0)
        assert result == []

    def test_distance_to_route_is_non_negative(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].distance_to_route_km >= 0.0

    def test_lat_lon_stored_correctly(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.1)]
        result = find_housing_near_route(track, features, max_distance_km=15.0)
        assert len(result) == 1
        assert result[0].lat == pytest.approx(48.5, abs=0.001)
        assert result[0].lon == pytest.approx(2.1, abs=0.001)

    def test_returns_housing_point_instances(self):
        track = _make_track([(48.0, 2.0), (49.0, 2.0)])
        features = [_make_housing_feature(48.5, 2.0)]
        result = find_housing_near_route(track, features, max_distance_km=5.0)
        assert all(isinstance(p, HousingPoint) for p in result)


# ---------------------------------------------------------------------------
# serialize_housing_points
# ---------------------------------------------------------------------------

class TestSerializeHousingPoints:
    def test_all_fields_present(self):
        point = HousingPoint(
            osm_id="node/42",
            type="hotel",
            name="Hotel Vélo",
            website="https://example.com",
            phone="+33 1 23 45 67 89",
            lat=48.5,
            lon=2.3,
            distance_to_route_km=1.2,
        )
        result = serialize_housing_points([point])
        assert len(result) == 1
        d = result[0]
        assert d["osm_id"] == "node/42"
        assert d["type"] == "hotel"
        assert d["name"] == "Hotel Vélo"
        assert d["website"] == "https://example.com"
        assert d["phone"] == "+33 1 23 45 67 89"
        assert d["lat"] == pytest.approx(48.5)
        assert d["lon"] == pytest.approx(2.3)

    def test_null_fields_serialised_as_none(self):
        """None values in HousingPoint are preserved as None in the dict."""
        point = HousingPoint(
            osm_id="node/99",
            type=None,
            name=None,
            website=None,
            phone=None,
            lat=48.0,
            lon=2.0,
            distance_to_route_km=0.5,
        )
        result = serialize_housing_points([point])
        d = result[0]
        assert d["type"] is None
        assert d["name"] is None
        assert d["website"] is None
        assert d["phone"] is None

    def test_output_is_json_serializable(self):
        """serialize_housing_points output must survive json.dumps()."""
        point = HousingPoint(
            osm_id="node/1",
            type="camp_site",
            name=None,
            website=None,
            phone=None,
            lat=47.0,
            lon=3.0,
            distance_to_route_km=2.1,
        )
        result = serialize_housing_points([point])
        serialized = json.dumps(result)
        assert "node/1" in serialized
        assert "null" in serialized

    def test_empty_list_returns_empty(self):
        assert serialize_housing_points([]) == []

    def test_multiple_points_all_serialized(self):
        points = [
            HousingPoint("node/1", "hotel", "A", None, None, 48.0, 2.0, 1.0),
            HousingPoint("node/2", "hostel", "B", None, None, 49.0, 2.0, 2.0),
        ]
        result = serialize_housing_points(points)
        assert len(result) == 2
        assert result[0]["osm_id"] == "node/1"
        assert result[1]["osm_id"] == "node/2"
