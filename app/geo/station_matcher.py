"""
Station-to-route proximity matching.

For each Eurovelo GPX track, finds all SNCF train stations located within a
configurable distance (default 5 km) of the route polyline. Uses a bounding-box
pre-filter to avoid a full O(stations × track_points) scan on large GPX files.
"""

import json
import math
from dataclasses import dataclass, asdict

from app.geo.distance import (
    cumulative_distances_km,
    point_to_polyline_distance_km,
)
from app.geo.gpx_parser import GpxTrack
from app.constants import BBOX_MARGIN_DEG


@dataclass
class StationOnRoute:
    """
    A train station that lies within proximity of an Eurovelo route.

    Attributes:
        nom: Station name (French), from the GeoJSON 'nom' property.
        libellecourt: 3-letter SNCF code, from 'libellecourt'.
        codes_uic: List of UIC codes (split on ';'). At least one element.
        lat: Station latitude, decimal degrees.
        lon: Station longitude, decimal degrees.
        distance_to_route_km: Shortest distance from station to route polyline (km).
        cumulative_km: Distance along the route (km from start) at the closest point.
    """

    nom: str
    libellecourt: str
    codes_uic: list[str]
    lat: float
    lon: float
    distance_to_route_km: float
    cumulative_km: float


def parse_uic_codes(codes_uic_str: str) -> list[str]:
    """
    Split a semicolon-separated UIC string into individual code strings.

    Some SNCF stations serve multiple lines and carry several UIC codes joined
    by semicolons (e.g. 'Avignon TGV': '87318964;87756975').

    Args:
        codes_uic_str: Raw string from the GeoJSON 'codes_uic' property.
                       May be a single code or semicolon-separated list.

    Returns:
        List of individual UIC code strings. Empty list if input is empty or None.
    """
    if not codes_uic_str:
        return []
    return [code.strip() for code in codes_uic_str.split(";") if code.strip()]


def load_stations(geojson_path: str) -> list[dict]:
    """
    Load all station features from a GeoJSON FeatureCollection file.

    Expects the standard SNCF 'gares-de-voyageurs.geojson' structure:
    a FeatureCollection of Point features where each feature has properties
    'nom', 'libellecourt', 'codes_uic', and coordinates [lon, lat].

    Args:
        geojson_path: Path to the GeoJSON file (absolute or relative to cwd).

    Returns:
        List of raw GeoJSON feature dicts. One dict per station.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file is not a valid FeatureCollection with features.
    """
    with open(geojson_path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("type") != "FeatureCollection":
        raise ValueError("GeoJSON file is not a FeatureCollection")
    features = data.get("features")
    if not features:
        raise ValueError("GeoJSON FeatureCollection has no features")
    return features


def _station_bounding_box(
    lat: float,
    lon: float,
    margin_deg: float,
) -> tuple[float, float, float, float]:
    """
    Compute a lat/lon bounding box around a station with a given margin.

    Args:
        lat: Station latitude, decimal degrees.
        lon: Station longitude, decimal degrees.
        margin_deg: Angular margin to add on each side, in degrees.

    Returns:
        (lat_min, lat_max, lon_min, lon_max) tuple.
    """
    return (
        lat - margin_deg,
        lat + margin_deg,
        lon - margin_deg,
        lon + margin_deg,
    )


def _filter_polyline_in_bbox(
    polyline: list[tuple[float, float]],
    lat_min: float,
    lat_max: float,
    lon_min: float,
    lon_max: float,
) -> list[tuple[float, float]]:
    """
    Return the subset of the polyline relevant to the bounding box.

    Includes any segment whose axis-aligned bounding box overlaps the query box.
    This correctly handles segments that span across the query box without
    having an endpoint inside it.

    Args:
        polyline: Full list of (lat, lon) tuples.
        lat_min, lat_max, lon_min, lon_max: Query bounding box limits.

    Returns:
        Sub-list of (lat, lon) tuples forming the relevant segments.
        May be empty if no segments overlap the box.
    """
    indices_in_box: set[int] = set()
    for i in range(len(polyline) - 1):
        a_lat, a_lon = polyline[i]
        b_lat, b_lon = polyline[i + 1]
        # Segment AABB vs query box overlap test (separating axis theorem)
        seg_lat_min = min(a_lat, b_lat)
        seg_lat_max = max(a_lat, b_lat)
        seg_lon_min = min(a_lon, b_lon)
        seg_lon_max = max(a_lon, b_lon)
        if (
            seg_lat_max >= lat_min and seg_lat_min <= lat_max
            and seg_lon_max >= lon_min and seg_lon_min <= lon_max
        ):
            indices_in_box.add(i)
            indices_in_box.add(i + 1)
    # Also include isolated points inside the box (single-point case)
    for i, (lat, lon) in enumerate(polyline):
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            indices_in_box.add(i)
    if not indices_in_box:
        return []
    return [polyline[i] for i in sorted(indices_in_box)]


def closest_point_on_route_km(
    station_lat: float,
    station_lon: float,
    polyline: list[tuple[float, float]],
    cumulative_km: list[float],
) -> tuple[float, float]:
    """
    Find the closest point on a route polyline to a station.

    Iterates over all segments and tracks the one with minimum distance.
    Returns both the minimum distance and the cumulative km at the closest point.

    Args:
        station_lat: Station latitude, decimal degrees.
        station_lon: Station longitude, decimal degrees.
        polyline: Ordered list of (lat, lon) tuples for the full route.
        cumulative_km: Precomputed cumulative distances, same length as polyline.

    Returns:
        (distance_km, cumulative_km_on_route) tuple.

    Raises:
        ValueError: If polyline is empty.
    """
    if not polyline:
        raise ValueError("polyline must be non-empty")
    if len(polyline) == 1:
        from app.geo.distance import haversine_km
        dist = haversine_km(station_lat, station_lon, polyline[0][0], polyline[0][1])
        return dist, cumulative_km[0]

    min_dist = math.inf
    best_cum_km = 0.0

    for i in range(len(polyline) - 1):
        a_lat, a_lon = polyline[i]
        b_lat, b_lon = polyline[i + 1]

        # Planar projection to find closest point on this segment
        dx = b_lon - a_lon
        dy = b_lat - a_lat
        seg_len_sq = dx * dx + dy * dy

        if seg_len_sq == 0.0:
            t = 0.0
        else:
            t = (
                (station_lon - a_lon) * dx + (station_lat - a_lat) * dy
            ) / seg_len_sq
            t = max(0.0, min(1.0, t))

        closest_lat = a_lat + t * dy
        closest_lon = a_lon + t * dx

        from app.geo.distance import haversine_km
        dist = haversine_km(station_lat, station_lon, closest_lat, closest_lon)

        if dist < min_dist:
            min_dist = dist
            # Cumulative km at the closest point = linear interpolation on this segment
            seg_start_km = cumulative_km[i]
            seg_end_km = cumulative_km[i + 1]
            best_cum_km = seg_start_km + t * (seg_end_km - seg_start_km)

    return min_dist, best_cum_km


def find_stations_near_route(
    track: GpxTrack,
    stations: list[dict],
    max_distance_km: float,
) -> list[StationOnRoute]:
    """
    Return all stations within max_distance_km of the route polyline.

    Uses a bounding-box pre-filter to limit the number of segments checked per
    station, making the function tractable for large GPX files (e.g. 76k points).

    Args:
        track: Parsed GPX track to check against.
        stations: List of raw GeoJSON feature dicts from load_stations().
        max_distance_km: Maximum allowed distance from station to route, in km.

    Returns:
        List of StationOnRoute, sorted ascending by cumulative_km.
        Empty list if no stations are within range.
    """
    polyline = track.points
    cum_km = cumulative_distances_km(polyline)
    results: list[StationOnRoute] = []

    for feature in stations:
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue

        lon, lat = float(coords[0]), float(coords[1])
        nom = props.get("nom", "")
        libellecourt = props.get("libellecourt", "")
        codes_uic = parse_uic_codes(props.get("codes_uic", ""))

        if not codes_uic:
            continue

        # Bounding-box pre-filter: only process segments near the station
        lat_min, lat_max, lon_min, lon_max = _station_bounding_box(
            lat, lon, BBOX_MARGIN_DEG
        )
        local_polyline = _filter_polyline_in_bbox(
            polyline, lat_min, lat_max, lon_min, lon_max
        )
        if not local_polyline:
            continue

        # Full distance check against filtered sub-polyline
        dist_to_local = point_to_polyline_distance_km(lat, lon, local_polyline)
        if dist_to_local > max_distance_km:
            continue

        # Exact cumulative-km using full polyline for accurate position
        dist_km, cum_km_at_closest = closest_point_on_route_km(
            lat, lon, polyline, cum_km
        )
        if dist_km <= max_distance_km:
            results.append(
                StationOnRoute(
                    nom=nom,
                    libellecourt=libellecourt,
                    codes_uic=codes_uic,
                    lat=lat,
                    lon=lon,
                    distance_to_route_km=round(dist_km, 3),
                    cumulative_km=round(cum_km_at_closest, 3),
                )
            )

    results.sort(key=lambda s: s.cumulative_km)
    return results


def serialize_route_stations(
    route_id: str,
    name: str,
    total_km: float,
    stations: list[StationOnRoute],
) -> dict:
    """
    Convert a list of StationOnRoute into the JSON-serializable dict for one route.

    Args:
        route_id: Eurovelo route identifier string (e.g. "EV15").
        name: Human-readable route name.
        total_km: Total length of the route in km.
        stations: List of StationOnRoute objects to serialize.

    Returns:
        Dict with keys 'route_id', 'name', 'total_km', 'stations' (list of dicts).
    """
    return {
        "route_id": route_id,
        "name": name,
        "total_km": round(total_km, 3),
        "stations": [asdict(s) for s in stations],
    }
