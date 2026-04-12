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

# Grid cell size for spatial indexing. Must equal BBOX_MARGIN_DEG so that a
# single margin-radius lookup covers 2–3 cells in each axis.
_GRID_CELL_DEG = 0.1


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


def _build_route_spatial_grid(
    polyline: list[tuple[float, float]],
) -> dict[tuple[int, int], list[int]]:
    """
    Build a spatial hash grid mapping grid cells to polyline point indices.

    Divides the polyline into cells of _GRID_CELL_DEG × _GRID_CELL_DEG degrees.
    Each point is recorded in its cell. For segments that span multiple cells,
    intermediate cells are also recorded so that proximity queries near a segment
    midpoint cannot miss a nearby segment. Used to retrieve candidate nearby
    points in O(cells) rather than O(N segments) during proximity search.

    Args:
        polyline: Ordered list of (lat, lon) tuples.

    Returns:
        Dict mapping (lat_cell, lon_cell) integer cell keys to lists of
        point indices. Cell keys are math.floor(coord / _GRID_CELL_DEG).
    """
    grid: dict[tuple[int, int], list[int]] = {}
    for i, (lat, lon) in enumerate(polyline):
        cell = (
            math.floor(lat / _GRID_CELL_DEG),
            math.floor(lon / _GRID_CELL_DEG),
        )
        grid.setdefault(cell, []).append(i)

        # For segments that span more than one cell, also record intermediate
        # cells so that points near the segment midpoint are not missed.
        # (Real GPX segments are ~20 m, so this branch is rarely taken in
        # production; it is mainly needed for synthetic long-segment test data.)
        if i + 1 >= len(polyline):
            continue
        next_lat, next_lon = polyline[i + 1]
        dlat = next_lat - lat
        dlon = next_lon - lon
        steps = max(abs(dlat), abs(dlon)) / _GRID_CELL_DEG
        if steps <= 1.0:
            continue
        n = int(math.ceil(steps))
        for k in range(1, n):
            t = k / n
            mid_cell = (
                math.floor((lat + t * dlat) / _GRID_CELL_DEG),
                math.floor((lon + t * dlon) / _GRID_CELL_DEG),
            )
            grid.setdefault(mid_cell, []).append(i)

    return grid


def _extract_local_polyline_from_grid(
    polyline: list[tuple[float, float]],
    grid: dict[tuple[int, int], list[int]],
    lat: float,
    lon: float,
    margin_deg: float,
) -> list[tuple[float, float]]:
    """
    Return the subset of polyline points within margin_deg of (lat, lon).

    Looks up all grid cells that overlap the query bounding box and collects
    the corresponding polyline points. For each segment-start index i found,
    also includes i+1 so that the full segment (i → i+1) participates in the
    distance check — without this, a point near the midpoint of a long segment
    would only receive one endpoint in the local polyline. This is O(cells + k)
    where cells ≈ 4–9 and k is the number of nearby points, versus O(N) for
    the segment scan.

    Args:
        polyline: Full route polyline.
        grid: Spatial grid built by _build_route_spatial_grid.
        lat: Query latitude, decimal degrees.
        lon: Query longitude, decimal degrees.
        margin_deg: Search radius in degrees.

    Returns:
        Sorted list of nearby (lat, lon) tuples. Empty if no points are found.
    """
    lat_min_cell = math.floor((lat - margin_deg) / _GRID_CELL_DEG)
    lat_max_cell = math.floor((lat + margin_deg) / _GRID_CELL_DEG)
    lon_min_cell = math.floor((lon - margin_deg) / _GRID_CELL_DEG)
    lon_max_cell = math.floor((lon + margin_deg) / _GRID_CELL_DEG)

    indices: set[int] = set()
    for clat in range(lat_min_cell, lat_max_cell + 1):
        for clon in range(lon_min_cell, lon_max_cell + 1):
            cell_indices = grid.get((clat, clon))
            if cell_indices:
                indices.update(cell_indices)

    if not indices:
        return []

    # Include the next point for each segment-start index so that full segments
    # are represented in the local polyline used for distance computation.
    n = len(polyline)
    expanded = set(indices)
    for i in indices:
        if i + 1 < n:
            expanded.add(i + 1)

    return [polyline[i] for i in sorted(expanded)]


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


def _extract_lat_lon(feature: dict) -> tuple[float, float] | None:
    """
    Extract a representative (lat, lon) from a GeoJSON feature.

    Handles Point, Polygon, and MultiPolygon geometry types.  For polygons the
    centroid of the exterior ring is used as the representative position.

    Args:
        feature: GeoJSON feature dict. The geometry may be Point, Polygon, or
                 MultiPolygon.

    Returns:
        (lat, lon) tuple in decimal degrees, or None if the geometry type is
        unsupported or the coordinate array is malformed.
    """
    geom = feature.get("geometry") or {}
    geom_type = geom.get("type")
    coords = geom.get("coordinates") or []

    if geom_type == "Point":
        if len(coords) < 2:
            return None
        return float(coords[1]), float(coords[0])

    if geom_type == "Polygon":
        ring = coords[0] if coords else []
        if not ring:
            return None
        lat = sum(float(p[1]) for p in ring) / len(ring)
        lon = sum(float(p[0]) for p in ring) / len(ring)
        return lat, lon

    if geom_type == "MultiPolygon":
        ring = coords[0][0] if coords and coords[0] else []
        if not ring:
            return None
        lat = sum(float(p[1]) for p in ring) / len(ring)
        lon = sum(float(p[0]) for p in ring) / len(ring)
        return lat, lon

    return None


def find_features_near_route(
    track: GpxTrack,
    features: list[dict],
    max_distance_km: float,
) -> list[tuple[dict, float, float]]:
    """
    Return GeoJSON features within max_distance_km of the route polyline.

    Generic version of find_stations_near_route — works with any GeoJSON
    FeatureCollection.  Supports Point, Polygon, and MultiPolygon geometry;
    for polygons the centroid of the exterior ring is used as the
    representative position.  Uses a spatial grid pre-filter to keep the
    scan tractable for large GPX files (e.g. 76 k points).

    Args:
        track: Parsed GPX track to check against.
        features: List of GeoJSON feature dicts (Point, Polygon, or
                  MultiPolygon geometry).
        max_distance_km: Maximum allowed distance from feature to route, in km.

    Returns:
        List of (feature, distance_km, cumulative_km) tuples, sorted ascending
        by cumulative_km.  Empty list if no features are within range.
    """
    polyline = track.points
    cum_km = cumulative_distances_km(polyline)
    # Build spatial grid once (O(N)); each per-feature lookup is then O(cells).
    route_grid = _build_route_spatial_grid(polyline)
    results: list[tuple[dict, float, float]] = []

    for feature in features:
        lat_lon = _extract_lat_lon(feature)
        if lat_lon is None:
            continue
        lat, lon = lat_lon

        local_polyline = _extract_local_polyline_from_grid(
            polyline, route_grid, lat, lon, BBOX_MARGIN_DEG
        )
        if not local_polyline:
            continue

        dist_to_local = point_to_polyline_distance_km(lat, lon, local_polyline)
        if dist_to_local > max_distance_km:
            continue

        dist_km, cum_km_at_closest = closest_point_on_route_km(
            lat, lon, polyline, cum_km
        )
        if dist_km <= max_distance_km:
            results.append((feature, round(dist_km, 3), round(cum_km_at_closest, 3)))

    results.sort(key=lambda t: t[2])
    return results


def find_stations_near_route(
    track: GpxTrack,
    stations: list[dict],
    max_distance_km: float,
) -> list[StationOnRoute]:
    """
    Return all stations within max_distance_km of the route polyline.

    Thin typed wrapper over find_features_near_route.  Applies the additional
    UIC-code filter required for SNCF station features and constructs
    StationOnRoute objects from the returned generic tuples.

    Args:
        track: Parsed GPX track to check against.
        stations: List of raw GeoJSON feature dicts from load_stations().
        max_distance_km: Maximum allowed distance from station to route, in km.

    Returns:
        List of StationOnRoute, sorted ascending by cumulative_km.
        Empty list if no stations are within range.
    """
    results: list[StationOnRoute] = []

    for feature, dist_km, cum_km_at_closest in find_features_near_route(
        track, stations, max_distance_km
    ):
        props = feature.get("properties", {})
        codes_uic = parse_uic_codes(props.get("codes_uic", ""))
        if not codes_uic:
            continue
        results.append(
            StationOnRoute(
                nom=props.get("nom", ""),
                libellecourt=props.get("libellecourt", ""),
                codes_uic=codes_uic,
                lat=float(feature["geometry"]["coordinates"][1]),
                lon=float(feature["geometry"]["coordinates"][0]),
                distance_to_route_km=dist_km,
                cumulative_km=cum_km_at_closest,
            )
        )

    # find_features_near_route already sorts by cumulative_km; keep the order.
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