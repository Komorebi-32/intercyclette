"""
Unit tests for app.geo.distance.

Each test is isolated (no I/O, no external state). Floating-point comparisons
use absolute tolerances appropriate to the precision of the haversine formula.
"""

import math
import pytest
from app.geo.distance import (
    haversine_km,
    point_to_segment_distance_km,
    point_to_polyline_distance_km,
    cumulative_distances_km,
    interpolate_point_at_km,
)


# ---------------------------------------------------------------------------
# haversine_km
# ---------------------------------------------------------------------------

class TestHaversineKm:
    def test_same_point_returns_zero(self):
        """Distance from a point to itself must be zero."""
        assert haversine_km(48.8566, 2.3522, 48.8566, 2.3522) == pytest.approx(0.0, abs=1e-9)

    def test_paris_to_lyon_approximately_390km(self):
        """Paris–Lyon is approximately 390 km as the crow flies."""
        dist = haversine_km(48.8566, 2.3522, 45.7640, 4.8357)
        assert 380 < dist < 400

    def test_paris_to_bordeaux_approximately_500km(self):
        """Paris–Bordeaux is approximately 500 km as the crow flies."""
        dist = haversine_km(48.8566, 2.3522, 44.8378, -0.5792)
        assert 490 < dist < 520

    def test_symmetry(self):
        """haversine_km(A, B) == haversine_km(B, A)."""
        d1 = haversine_km(48.8566, 2.3522, 45.7640, 4.8357)
        d2 = haversine_km(45.7640, 4.8357, 48.8566, 2.3522)
        assert d1 == pytest.approx(d2, abs=1e-9)

    def test_returns_non_negative(self):
        """Distance is always non-negative."""
        assert haversine_km(0.0, 0.0, -1.0, -1.0) >= 0.0

    def test_antipodal_points(self):
        """Antipodal distance is approximately pi * R ≈ 20015 km."""
        dist = haversine_km(0.0, 0.0, 0.0, 180.0)
        assert dist == pytest.approx(math.pi * 6371.0, rel=1e-3)


# ---------------------------------------------------------------------------
# point_to_segment_distance_km
# ---------------------------------------------------------------------------

class TestPointToSegmentDistanceKm:
    def test_point_on_segment_returns_zero(self):
        """A point that lies on the segment should return distance ≈ 0."""
        # Midpoint of a purely latitudinal segment
        dist = point_to_segment_distance_km(
            pt_lat=48.0, pt_lon=2.0,
            seg_a_lat=48.0, seg_a_lon=1.0,
            seg_b_lat=48.0, seg_b_lon=3.0,
        )
        assert dist == pytest.approx(0.0, abs=0.01)

    def test_point_at_endpoint_returns_zero(self):
        """A point coinciding with segment start should return distance ≈ 0."""
        dist = point_to_segment_distance_km(
            pt_lat=48.0, pt_lon=2.0,
            seg_a_lat=48.0, seg_a_lon=2.0,
            seg_b_lat=48.0, seg_b_lon=4.0,
        )
        assert dist == pytest.approx(0.0, abs=0.01)

    def test_point_perpendicular_to_segment(self):
        """Point directly north of a horizontal segment."""
        # Segment: (48°N, 2°E) to (48°N, 3°E). Point: (49°N, 2.5°E)
        # Closest point on segment is the foot of the perpendicular ≈ (48°N, 2.5°E)
        # Distance ≈ 1° latitude ≈ 111 km
        dist = point_to_segment_distance_km(
            pt_lat=49.0, pt_lon=2.5,
            seg_a_lat=48.0, seg_a_lon=2.0,
            seg_b_lat=48.0, seg_b_lon=3.0,
        )
        assert 100 < dist < 120

    def test_degenerate_segment_same_endpoints(self):
        """When A == B, distance equals point-to-point distance to A."""
        dist = point_to_segment_distance_km(
            pt_lat=49.0, pt_lon=2.0,
            seg_a_lat=48.0, seg_a_lon=2.0,
            seg_b_lat=48.0, seg_b_lon=2.0,
        )
        expected = haversine_km(49.0, 2.0, 48.0, 2.0)
        assert dist == pytest.approx(expected, abs=0.1)

    def test_point_beyond_segment_end_clamps(self):
        """Point beyond B should map to B, not the extended line."""
        dist = point_to_segment_distance_km(
            pt_lat=48.0, pt_lon=5.0,       # well east of segment
            seg_a_lat=48.0, seg_a_lon=1.0,
            seg_b_lat=48.0, seg_b_lon=2.0,
        )
        expected = haversine_km(48.0, 5.0, 48.0, 2.0)
        assert dist == pytest.approx(expected, rel=0.01)


# ---------------------------------------------------------------------------
# point_to_polyline_distance_km
# ---------------------------------------------------------------------------

class TestPointToPolylineDistanceKm:
    def test_single_point_polyline_returns_point_distance(self):
        """Polyline of one point behaves like point-to-point distance."""
        dist = point_to_polyline_distance_km(49.0, 2.0, [(48.0, 2.0)])
        expected = haversine_km(49.0, 2.0, 48.0, 2.0)
        assert dist == pytest.approx(expected, abs=0.01)

    def test_empty_polyline_raises(self):
        """Empty polyline must raise ValueError."""
        with pytest.raises(ValueError):
            point_to_polyline_distance_km(48.0, 2.0, [])

    def test_point_on_polyline_returns_zero(self):
        """A point lying on a segment of the polyline returns ~0."""
        polyline = [(48.0, 1.0), (48.0, 2.0), (48.0, 3.0)]
        dist = point_to_polyline_distance_km(48.0, 1.5, polyline)
        assert dist == pytest.approx(0.0, abs=0.01)

    def test_minimum_segment_is_selected(self):
        """Returns distance to nearest segment, not the first one."""
        polyline = [(48.0, 1.0), (48.0, 2.0), (48.0, 3.0)]
        # Point is very close to the second segment midpoint (48°N, 2.5°E)
        dist = point_to_polyline_distance_km(48.0, 2.5, polyline)
        assert dist == pytest.approx(0.0, abs=0.01)

    def test_returns_non_negative(self):
        """Result is always non-negative."""
        polyline = [(44.0, -1.0), (46.0, 2.0), (48.0, 4.0)]
        dist = point_to_polyline_distance_km(50.0, 6.0, polyline)
        assert dist >= 0.0


# ---------------------------------------------------------------------------
# cumulative_distances_km
# ---------------------------------------------------------------------------

class TestCumulativeDistancesKm:
    def test_single_point_returns_zero_list(self):
        """Single-point polyline produces [0.0]."""
        result = cumulative_distances_km([(48.0, 2.0)])
        assert result == [0.0]

    def test_empty_raises(self):
        """Empty polyline raises ValueError."""
        with pytest.raises(ValueError):
            cumulative_distances_km([])

    def test_first_element_always_zero(self):
        """First element of the output is always 0.0."""
        pts = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        result = cumulative_distances_km(pts)
        assert result[0] == 0.0

    def test_monotonically_increasing(self):
        """Cumulative distances are strictly non-decreasing."""
        pts = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0), (50.0, 3.0)]
        result = cumulative_distances_km(pts)
        for i in range(1, len(result)):
            assert result[i] >= result[i - 1]

    def test_same_length_as_polyline(self):
        """Output list has same length as input polyline."""
        pts = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        result = cumulative_distances_km(pts)
        assert len(result) == len(pts)

    def test_two_point_distance_matches_haversine(self):
        """Two-point polyline total == haversine between the two points."""
        from app.geo.distance import haversine_km
        pts = [(48.8566, 2.3522), (45.7640, 4.8357)]
        result = cumulative_distances_km(pts)
        expected = haversine_km(48.8566, 2.3522, 45.7640, 4.8357)
        assert result[1] == pytest.approx(expected, abs=0.001)

    def test_collinear_segments_sum_correctly(self):
        """Three collinear points: total ≈ sum of individual segments."""
        pts = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        result = cumulative_distances_km(pts)
        d1 = haversine_km(48.0, 2.0, 49.0, 2.0)
        d2 = haversine_km(49.0, 2.0, 50.0, 2.0)
        assert result[1] == pytest.approx(d1, abs=0.001)
        assert result[2] == pytest.approx(d1 + d2, abs=0.001)


# ---------------------------------------------------------------------------
# interpolate_point_at_km
# ---------------------------------------------------------------------------

class TestInterpolatePointAtKm:
    def _make_simple(self):
        """Three-point polyline going north along lon=2.0."""
        polyline = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
        cum = cumulative_distances_km(polyline)
        return polyline, cum

    def test_at_zero_returns_first_point(self):
        polyline, cum = self._make_simple()
        lat, lon = interpolate_point_at_km(polyline, cum, 0.0)
        assert lat == pytest.approx(48.0, abs=1e-6)
        assert lon == pytest.approx(2.0, abs=1e-6)

    def test_at_total_returns_last_point(self):
        polyline, cum = self._make_simple()
        lat, lon = interpolate_point_at_km(polyline, cum, cum[-1])
        assert lat == pytest.approx(50.0, abs=0.01)
        assert lon == pytest.approx(2.0, abs=0.01)

    def test_midpoint_interpolation(self):
        """At half the first segment, should be approximately halfway between pts 0 and 1."""
        polyline, cum = self._make_simple()
        mid_km = cum[1] / 2.0
        lat, lon = interpolate_point_at_km(polyline, cum, mid_km)
        # Should be close to 48.5°N along lon=2.0
        assert 48.0 < lat < 49.0
        assert lon == pytest.approx(2.0, abs=0.01)

    def test_negative_target_raises(self):
        polyline, cum = self._make_simple()
        with pytest.raises(ValueError):
            interpolate_point_at_km(polyline, cum, -1.0)

    def test_target_beyond_total_raises(self):
        polyline, cum = self._make_simple()
        with pytest.raises(ValueError):
            interpolate_point_at_km(polyline, cum, cum[-1] + 1.0)

    def test_empty_inputs_raise(self):
        with pytest.raises(ValueError):
            interpolate_point_at_km([], [], 0.0)
