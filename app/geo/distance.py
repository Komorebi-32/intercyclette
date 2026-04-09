"""
Pure geometry functions for geodesic distance computations.

All functions operate on WGS84 decimal-degree coordinates (latitude, longitude).
No I/O or side effects — safe to call from any context.
"""

import math
from app.constants import EARTH_RADIUS_KM


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Compute the great-circle distance in km between two WGS84 points.

    Args:
        lat1: Latitude of point 1, decimal degrees.
        lon1: Longitude of point 1, decimal degrees.
        lat2: Latitude of point 2, decimal degrees.
        lon2: Longitude of point 2, decimal degrees.

    Returns:
        Distance in km as a non-negative float.
    """
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _project_point_onto_segment(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> tuple[float, float]:
    """
    Project point P onto segment AB using planar (Cartesian) coordinates.

    Uses the parametric form of the line AB, clamping t to [0, 1] so the
    projection stays within the segment. Suitable for short geodesic segments
    (< ~50 km) where the planar approximation is accurate enough.

    Args:
        px, py: Coordinates of the point to project.
        ax, ay: Coordinates of segment start.
        bx, by: Coordinates of segment end.

    Returns:
        (x, y) of the closest point on segment AB to P.
    """
    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0.0:
        return ax, ay
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    return ax + t * dx, ay + t * dy


def point_to_segment_distance_km(
    pt_lat: float,
    pt_lon: float,
    seg_a_lat: float,
    seg_a_lon: float,
    seg_b_lat: float,
    seg_b_lon: float,
) -> float:
    """
    Compute the shortest distance in km from point P to line segment AB.

    Uses a planar projection, which is accurate for segments shorter than ~50 km.

    Args:
        pt_lat: Latitude of point P, decimal degrees.
        pt_lon: Longitude of point P, decimal degrees.
        seg_a_lat: Latitude of segment start A, decimal degrees.
        seg_a_lon: Longitude of segment start A, decimal degrees.
        seg_b_lat: Latitude of segment end B, decimal degrees.
        seg_b_lon: Longitude of segment end B, decimal degrees.

    Returns:
        Minimum distance in km from P to the segment, as a non-negative float.
    """
    cx, cy = _project_point_onto_segment(
        pt_lon, pt_lat,
        seg_a_lon, seg_a_lat,
        seg_b_lon, seg_b_lat,
    )
    return haversine_km(pt_lat, pt_lon, cy, cx)


def point_to_polyline_distance_km(
    pt_lat: float,
    pt_lon: float,
    polyline: list[tuple[float, float]],
) -> float:
    """
    Compute the minimum distance in km from a point to any segment of a polyline.

    Args:
        pt_lat: Latitude of the point, decimal degrees.
        pt_lon: Longitude of the point, decimal degrees.
        polyline: Ordered list of (lat, lon) tuples representing the polyline.
                  Must contain at least one point.

    Returns:
        Minimum distance in km. If polyline has a single point, returns the
        distance to that point.

    Raises:
        ValueError: If polyline is empty.
    """
    if not polyline:
        raise ValueError("polyline must contain at least one point")
    if len(polyline) == 1:
        return haversine_km(pt_lat, pt_lon, polyline[0][0], polyline[0][1])
    min_dist = math.inf
    for i in range(len(polyline) - 1):
        a_lat, a_lon = polyline[i]
        b_lat, b_lon = polyline[i + 1]
        d = point_to_segment_distance_km(pt_lat, pt_lon, a_lat, a_lon, b_lat, b_lon)
        if d < min_dist:
            min_dist = d
    return min_dist


def cumulative_distances_km(polyline: list[tuple[float, float]]) -> list[float]:
    """
    Compute cumulative distance in km along a polyline.

    Args:
        polyline: Ordered list of (lat, lon) tuples. Must be non-empty.

    Returns:
        List of floats, same length as polyline.
        Index 0 is always 0.0; each subsequent value is the total km travelled
        from the first point to that point along the polyline.

    Raises:
        ValueError: If polyline is empty.
    """
    if not polyline:
        raise ValueError("polyline must contain at least one point")
    cumulative = [0.0]
    for i in range(1, len(polyline)):
        prev_lat, prev_lon = polyline[i - 1]
        curr_lat, curr_lon = polyline[i]
        cumulative.append(cumulative[-1] + haversine_km(prev_lat, prev_lon, curr_lat, curr_lon))
    return cumulative


def interpolate_point_at_km(
    polyline: list[tuple[float, float]],
    cumulative_km: list[float],
    target_km: float,
) -> tuple[float, float]:
    """
    Return the (lat, lon) of the point at target_km along the polyline.

    Linearly interpolates between the two nearest track points.

    Args:
        polyline: Ordered list of (lat, lon) tuples.
        cumulative_km: Precomputed cumulative distances, same length as polyline.
                       Produced by cumulative_distances_km().
        target_km: The distance along the route at which to interpolate.
                   Must be in [0, total_km].

    Returns:
        (lat, lon) tuple at the requested position.

    Raises:
        ValueError: If target_km is outside [0, total_km] or inputs are empty.
    """
    if not polyline or not cumulative_km:
        raise ValueError("polyline and cumulative_km must be non-empty")
    total_km = cumulative_km[-1]
    if target_km < 0.0 or target_km > total_km:
        raise ValueError(
            f"target_km {target_km:.2f} is outside [0, {total_km:.2f}]"
        )
    # Find the segment that contains target_km.
    for i in range(1, len(cumulative_km)):
        if cumulative_km[i] >= target_km:
            seg_len = cumulative_km[i] - cumulative_km[i - 1]
            if seg_len == 0.0:
                return polyline[i]
            t = (target_km - cumulative_km[i - 1]) / seg_len
            lat = polyline[i - 1][0] + t * (polyline[i][0] - polyline[i - 1][0])
            lon = polyline[i - 1][1] + t * (polyline[i][1] - polyline[i - 1][1])
            return lat, lon
    # target_km == total_km exactly
    return polyline[-1]
