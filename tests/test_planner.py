"""
Unit tests for app.itinerary.planner.
"""

import json
import os
import tempfile
import pytest

from app.itinerary.planner import (
    load_route_index,
    get_stations_near_route_start,
    compute_end_station,
    downsample_geometry,
    _nearest_point_index,
    _extract_segment_points,
    find_itinerary_candidates,
    find_all_itineraries,
    TripCandidate,
)
from app.geo.station_matcher import StationOnRoute


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _station_dict(nom: str, cum_km: float, lat: float = 48.0, lon: float = 2.0) -> dict:
    return {
        "nom": nom,
        "libellecourt": nom[:3].upper(),
        "codes_uic": ["87000001"],
        "lat": lat,
        "lon": lon,
        "distance_to_route_km": 0.5,
        "cumulative_km": cum_km,
    }


def _route_data(
    total_km: float,
    stations: list[dict],
    name: str = "Test Route",
    track_points: list[list[float]] | None = None,
) -> dict:
    data = {
        "route_id": "TST",
        "name": name,
        "total_km": total_km,
        "stations": stations,
    }
    if track_points is not None:
        data["track_points"] = track_points
    return data


def _meridian_track(n: int, lon: float = 2.0) -> list[list[float]]:
    """A simple south-to-north track of n points along a meridian (lat 48..49)."""
    return [[48.0 + i * (1.0 / (n - 1)), lon] for i in range(n)]


def _make_index(routes: dict) -> dict:
    return {"generated_at": "2026-01-01T00:00:00+00:00", "routes": routes}


def _write_index(data: dict) -> str:
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return path


# ---------------------------------------------------------------------------
# load_route_index
# ---------------------------------------------------------------------------

class TestLoadRouteIndex:
    def test_returns_dict_with_routes_key(self, tmp_path):
        data = {"routes": {}, "generated_at": "2026-01-01"}
        path = str(tmp_path / "index.json")
        with open(path, "w") as f:
            json.dump(data, f)
        result = load_route_index(path)
        assert "routes" in result

    def test_file_not_found_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_route_index(str(tmp_path / "missing.json"))

    def test_missing_routes_key_raises(self, tmp_path):
        path = str(tmp_path / "bad.json")
        with open(path, "w") as f:
            json.dump({"something_else": {}}, f)
        with pytest.raises(ValueError, match="routes"):
            load_route_index(path)


# ---------------------------------------------------------------------------
# get_stations_near_route_start
# ---------------------------------------------------------------------------

class TestGetStationsNearRouteStart:
    def test_returns_stations_in_start_zone(self):
        # Route 200 km, start zone = 15% = 30 km
        route = _route_data(200.0, [
            _station_dict("Early", 10.0, lat=48.0, lon=2.0),
            _station_dict("Late", 150.0, lat=49.0, lon=2.0),
        ])
        result = get_stations_near_route_start(route, 48.0, 2.0, 3)
        noms = [s.nom for s in result]
        assert "Early" in noms
        assert "Late" not in noms

    def test_results_capped_at_n_candidates(self):
        stations = [_station_dict(f"S{i}", float(i)) for i in range(10)]
        route = _route_data(200.0, stations)
        result = get_stations_near_route_start(route, 48.0, 2.0, 3)
        assert len(result) <= 3

    def test_sorted_by_distance_to_departure(self):
        # Station A is at (48.0, 2.0) — same as departure
        # Station B is at (48.0, 3.0) — 1° east, farther away
        route = _route_data(200.0, [
            _station_dict("B", 5.0, lat=48.0, lon=3.0),
            _station_dict("A", 10.0, lat=48.0, lon=2.0),
        ])
        result = get_stations_near_route_start(route, 48.0, 2.0, 3)
        assert result[0].nom == "A"

    def test_empty_stations_returns_empty(self):
        route = _route_data(100.0, [])
        result = get_stations_near_route_start(route, 48.0, 2.0, 3)
        assert result == []

    def test_start_zone_capped_at_100km(self):
        # Route 1000 km, 15% = 150 km — should be capped at 100 km
        stations = [
            _station_dict("At 80km", 80.0),
            _station_dict("At 110km", 110.0),  # beyond 100 km cap
        ]
        route = _route_data(1000.0, stations)
        result = get_stations_near_route_start(route, 48.0, 2.0, 3)
        noms = [s.nom for s in result]
        assert "At 80km" in noms
        assert "At 110km" not in noms


# ---------------------------------------------------------------------------
# compute_end_station
# ---------------------------------------------------------------------------

class TestComputeEndStation:
    def _make_start(self, cum_km: float) -> StationOnRoute:
        return StationOnRoute(
            nom="Start", libellecourt="STR", codes_uic=["87000001"],
            lat=48.0, lon=2.0, distance_to_route_km=0.5, cumulative_km=cum_km,
        )

    def test_returns_station_closest_to_end_point(self):
        route = _route_data(300.0, [
            _station_dict("Near End", 190.0),
            _station_dict("Far", 50.0),
        ])
        start = self._make_start(100.0)
        # biking_km=100 → end_km=200; "Near End" at 190 is closest
        result = compute_end_station(route, start, 100.0)
        assert result is not None
        assert result.nom == "Near End"

    def test_empty_stations_returns_none(self):
        route = _route_data(300.0, [])
        start = self._make_start(0.0)
        assert compute_end_station(route, start, 100.0) is None

    def test_single_station_always_returned(self):
        route = _route_data(300.0, [_station_dict("Only", 150.0)])
        start = self._make_start(0.0)
        result = compute_end_station(route, start, 100.0)
        assert result is not None
        assert result.nom == "Only"


# ---------------------------------------------------------------------------
# downsample_geometry
# ---------------------------------------------------------------------------

class TestDownsampleGeometry:
    def test_empty_input_returns_empty(self):
        assert downsample_geometry([], 100) == []

    def test_fewer_points_than_max_unchanged(self):
        pts = [(48.0 + i * 0.1, 2.0) for i in range(5)]
        result = downsample_geometry(pts, 100)
        assert len(result) == 5

    def test_downsampled_respects_max_points(self):
        pts = [(float(i), 2.0) for i in range(2000)]
        result = downsample_geometry(pts, 1000)
        assert len(result) <= 1001  # +1 because last point is always included

    def test_first_and_last_points_included(self):
        pts = [(float(i), 2.0) for i in range(500)]
        result = downsample_geometry(pts, 10)
        assert result[0] == [pts[0][0], pts[0][1]]
        assert result[-1] == [pts[-1][0], pts[-1][1]]

    def test_output_is_list_of_lists(self):
        pts = [(48.0, 2.0), (49.0, 2.0)]
        result = downsample_geometry(pts, 100)
        assert isinstance(result[0], list)
        assert len(result[0]) == 2


# ---------------------------------------------------------------------------
# _nearest_point_index
# ---------------------------------------------------------------------------

class TestNearestPointIndex:
    def test_empty_polyline_returns_minus_one(self):
        assert _nearest_point_index([], 48.0, 2.0) == -1

    def test_exact_vertex_match(self):
        poly = [(48.0, 2.0), (48.5, 2.0), (49.0, 2.0)]
        assert _nearest_point_index(poly, 48.5, 2.0) == 1

    def test_closest_of_several(self):
        poly = [(48.0, 2.0), (48.5, 2.0), (49.0, 2.0)]
        # 48.9 is nearest to the third vertex (49.0)
        assert _nearest_point_index(poly, 48.9, 2.0) == 2

    def test_first_vertex_when_before_start(self):
        poly = [(48.0, 2.0), (48.5, 2.0), (49.0, 2.0)]
        assert _nearest_point_index(poly, 47.0, 2.0) == 0


# ---------------------------------------------------------------------------
# _extract_segment_points
# ---------------------------------------------------------------------------

class TestExtractSegmentPoints:
    def _track(self) -> list[list[float]]:
        # 11 vertices: lat 48.0, 48.1, … 49.0 at lon 2.0
        return _meridian_track(11)

    def _station(self, lat: float, lon: float = 2.0) -> StationOnRoute:
        return StationOnRoute("S", "S", ["1"], lat, lon, 0.1, 0.0)

    def test_segment_spans_nearest_vertices_inclusive(self):
        track = self._track()
        start = self._station(48.2)   # nearest vertex index 2
        end = self._station(48.7)     # nearest vertex index 7
        seg = _extract_segment_points({"track_points": track}, start, end)
        assert seg[0] == tuple(track[2])
        assert seg[-1] == tuple(track[7])
        assert len(seg) == 6  # indices 2..7 inclusive

    def test_full_resolution_no_points_dropped(self):
        track = self._track()
        start = self._station(48.0)   # index 0
        end = self._station(49.0)     # index 10
        seg = _extract_segment_points({"track_points": track}, start, end)
        assert len(seg) == len(track)  # every vertex kept

    def test_reversed_stations_still_min_max_slice(self):
        track = self._track()
        start = self._station(48.7)   # index 7
        end = self._station(48.2)     # index 2
        seg = _extract_segment_points({"track_points": track}, start, end)
        # Slice is ordered along the track regardless of station order
        assert seg[0] == tuple(track[2])
        assert seg[-1] == tuple(track[7])
        assert len(seg) == 6

    def test_missing_track_points_returns_empty(self):
        start = self._station(48.2)
        end = self._station(48.7)
        assert _extract_segment_points({}, start, end) == []
        assert _extract_segment_points({"track_points": []}, start, end) == []


# ---------------------------------------------------------------------------
# find_itinerary_candidates
# ---------------------------------------------------------------------------

class TestFindItineraryCandidates:
    def _route_with_stations(self) -> dict:
        return _route_data(300.0, [
            _station_dict("Start1", 5.0, lat=48.0, lon=2.0),
            _station_dict("Start2", 20.0, lat=48.1, lon=2.0),
            _station_dict("End", 180.0, lat=49.5, lon=2.0),
        ])

    def test_returns_list_of_trip_candidates(self):
        route = self._route_with_stations()
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        assert all(isinstance(c, TripCandidate) for c in result)

    def test_route_id_preserved(self):
        route = self._route_with_stations()
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        assert all(c.route_id == "TST" for c in result)

    def test_n_days_and_rhythm_stored(self):
        route = self._route_with_stations()
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 5, "randonneur")
        for c in result:
            assert c.n_days == 5
            assert c.rhythm_key == "randonneur"

    def test_biking_end_km_greater_than_start(self):
        route = self._route_with_stations()
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        for c in result:
            assert c.biking_end_km >= c.biking_start_km

    def test_geometry_endpoints_snap_to_stations(self):
        track = [[48.0 + i * 0.1, 2.0] for i in range(21)]  # lat 48.0..50.0
        route = _route_data(300.0, [
            _station_dict("Start", 5.0, lat=48.0, lon=2.0),
            _station_dict("End", 180.0, lat=49.5, lon=2.0),
        ], track_points=track)
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        assert result
        poly = [(p[0], p[1]) for p in track]
        for c in result:
            i1 = _nearest_point_index(poly, c.departure_station.lat, c.departure_station.lon)
            i2 = _nearest_point_index(poly, c.arrival_station.lat, c.arrival_station.lon)
            assert c.geometry[0] == poly[min(i1, i2)]
            assert c.geometry[-1] == poly[max(i1, i2)]

    def test_no_start_stations_returns_empty(self):
        route = _route_data(300.0, [_station_dict("Only End", 200.0)])
        # 200 km > 100 km start zone cap → no start candidates
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        assert result == []

    def test_empty_route_returns_empty(self):
        route = _route_data(300.0, [])
        result = find_itinerary_candidates("TST", route, 48.0, 2.0, 3, "escargot")
        assert result == []


# ---------------------------------------------------------------------------
# find_all_itineraries
# ---------------------------------------------------------------------------

class TestFindAllItineraries:
    def _build_index(self) -> dict:
        route_a = _route_data(300.0, [
            _station_dict("A-Start", 5.0, lat=48.0, lon=2.0),
            _station_dict("A-End", 180.0, lat=49.5, lon=2.0),
        ], name="Route A")
        route_b = _route_data(200.0, [
            _station_dict("B-Start", 10.0, lat=47.0, lon=1.0),
            _station_dict("B-End", 120.0, lat=48.0, lon=1.0),
        ], name="Route B")
        return _make_index({"RA": route_a, "RB": route_b})

    def test_single_route_returns_multiple_candidates(self):
        index = _make_index({
            "RA": _route_data(300.0, [
                _station_dict("S1", 5.0, lat=48.0, lon=2.0),
                _station_dict("S2", 15.0, lat=48.1, lon=2.0),
                _station_dict("S3", 25.0, lat=48.2, lon=2.0),
                _station_dict("End", 180.0),
            ], name="Route A"),
        })
        result = find_all_itineraries(["RA"], index, 48.0, 2.0, 3, "escargot")
        # Single route selected → up to 3 candidates
        assert len(result) <= 3

    def test_multiple_routes_one_candidate_each(self):
        index = self._build_index()
        result = find_all_itineraries(["RA", "RB"], index, 48.0, 2.0, 3, "escargot")
        route_ids = [c.route_id for c in result]
        assert route_ids.count("RA") <= 1
        assert route_ids.count("RB") <= 1

    def test_unknown_route_id_skipped(self):
        index = self._build_index()
        result = find_all_itineraries(["UNKNOWN"], index, 48.0, 2.0, 3, "escargot")
        assert result == []

    def test_empty_route_ids_returns_empty(self):
        index = self._build_index()
        result = find_all_itineraries([], index, 48.0, 2.0, 3, "escargot")
        assert result == []

    def test_returns_trip_candidates(self):
        index = self._build_index()
        result = find_all_itineraries(["RA"], index, 48.0, 2.0, 3, "escargot")
        assert all(isinstance(c, TripCandidate) for c in result)
