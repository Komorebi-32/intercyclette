"""
Trip itinerary planner.

Assembles TripCandidate objects from the pre-computed route-stations index,
user inputs (departure coordinates, days, rhythm), and the Eurovelo route data.
Does not make any network calls — pure data assembly.
"""

import json
import math
from dataclasses import dataclass, field

from app.constants import (
    OUTBOUND_CANDIDATE_COUNT,
    ROUTE_START_ZONE_FRACTION,
    ROUTE_START_ZONE_MAX_KM,
)
from app.geo.distance import haversine_km
from app.geo.station_matcher import StationOnRoute
from app.itinerary.rhythm import get_rhythm, total_biking_km


@dataclass
class TripCandidate:
    """
    A candidate bike + train itinerary along one Eurovelo route.

    Attributes:
        route_id: Eurovelo route identifier (e.g. 'EV15').
        route_name: Human-readable route name.
        departure_station: Station the user arrives at by train (outbound).
        arrival_station: Station the user departs from by train (return).
        biking_start_km: Cumulative km on the route where biking begins.
        biking_end_km: Cumulative km on the route where biking ends.
        total_biking_km: Total distance cycled (km).
        n_days: Number of days for the whole trip.
        rhythm_key: Rhythm key used to compute the biking distance.
        geometry: Full-resolution list of [lat, lon] pairs for the biked segment
                  (for map rendering), sliced from the route's track_points
                  between the start and end stations.
    """

    route_id: str
    route_name: str
    departure_station: StationOnRoute
    arrival_station: StationOnRoute
    biking_start_km: float
    biking_end_km: float
    total_biking_km: float
    n_days: int
    rhythm_key: str
    geometry: list[list[float]] = field(default_factory=list)


def load_route_index(index_path: str) -> dict:
    """
    Load and validate the route_stations.json proximity index.

    Args:
        index_path: Path to the JSON file produced by scripts/preprocess.py.

    Returns:
        Parsed dict with at least 'routes' and 'generated_at' keys.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file is not valid JSON or missing required keys.
    """
    with open(index_path, encoding="utf-8") as f:
        data = json.load(f)
    if "routes" not in data:
        raise ValueError("Index file is missing 'routes' key")
    return data


def _deserialize_station(station_dict: dict) -> StationOnRoute:
    """
    Convert a station dict from the JSON index into a StationOnRoute dataclass.

    Args:
        station_dict: Dict with keys nom, libellecourt, codes_uic, lat, lon,
                      distance_to_route_km, cumulative_km.

    Returns:
        StationOnRoute dataclass instance.
    """
    return StationOnRoute(
        nom=station_dict["nom"],
        libellecourt=station_dict["libellecourt"],
        codes_uic=station_dict["codes_uic"],
        lat=station_dict["lat"],
        lon=station_dict["lon"],
        distance_to_route_km=station_dict["distance_to_route_km"],
        cumulative_km=station_dict["cumulative_km"],
    )


def get_stations_near_route_start(
    route_data: dict,
    departure_lat: float,
    departure_lon: float,
    n_candidates: int,
) -> list[StationOnRoute]:
    """
    Select candidate outbound stations from the start zone of a route.

    The start zone is the first ROUTE_START_ZONE_FRACTION of the route, capped at
    ROUTE_START_ZONE_MAX_KM. Among stations in the start zone, the n_candidates
    closest to the departure city (by haversine) are returned.

    Args:
        route_data: Single route dict from the index (key 'stations', 'total_km').
        departure_lat: Latitude of the user's departure city, decimal degrees.
        departure_lon: Longitude of the user's departure city, decimal degrees.
        n_candidates: Maximum number of stations to return.

    Returns:
        List of StationOnRoute sorted by ascending distance to departure city.
        May be shorter than n_candidates if fewer stations exist in the start zone.
    """
    total_km = route_data["total_km"]
    start_zone_km = min(
        total_km * ROUTE_START_ZONE_FRACTION,
        ROUTE_START_ZONE_MAX_KM,
    )
    stations_in_zone = [
        _deserialize_station(s)
        for s in route_data["stations"]
        if s["cumulative_km"] <= start_zone_km
    ]
    stations_in_zone.sort(
        key=lambda s: haversine_km(departure_lat, departure_lon, s.lat, s.lon)
    )
    return stations_in_zone[:n_candidates]


def compute_end_station(
    route_data: dict,
    start_station: StationOnRoute,
    biking_km: float,
) -> StationOnRoute | None:
    """
    Find the station closest to the expected end point after biking.

    The end point is start_station.cumulative_km + biking_km along the route.
    The station whose cumulative_km is nearest to this target is returned.

    Args:
        route_data: Single route dict from the index.
        start_station: Station where biking begins (outbound arrival).
        biking_km: Total biking distance in km.

    Returns:
        The StationOnRoute closest to the end point, or None if no stations
        exist in the index for this route.
    """
    stations = route_data["stations"]
    if not stations:
        return None
    target_km = start_station.cumulative_km + biking_km
    best = min(stations, key=lambda s: abs(s["cumulative_km"] - target_km))
    return _deserialize_station(best)


def downsample_geometry(
    points: list[tuple[float, float]],
    max_points: int,
) -> list[list[float]]:
    """
    Downsample a list of (lat, lon) tuples to at most max_points entries.

    Selects every N-th point where N = ceil(len(points) / max_points).
    Always includes the first and last point.

    Args:
        points: Full list of (lat, lon) tuples.
        max_points: Maximum number of points to return.

    Returns:
        List of [lat, lon] lists (JSON-serializable). Empty if points is empty.
    """
    if not points:
        return []
    if len(points) <= max_points:
        return [[lat, lon] for lat, lon in points]
    step = math.ceil(len(points) / max_points)
    sampled = [points[i] for i in range(0, len(points), step)]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return [[lat, lon] for lat, lon in sampled]


def round_geometry(
    points: list[tuple[float, float]],
    decimals: int,
) -> list[list[float]]:
    """
    Return every point as a [lat, lon] list with coordinates rounded.

    Unlike downsample_geometry, NO vertices are dropped — the full GPX
    resolution is preserved so the drawn line follows the real itinerary.
    Coordinates are only rounded to `decimals` places to reduce JSON size
    (5 dp ≈ 1.1 m, well below visible map precision).

    Args:
        points: Full list of (lat, lon) tuples.
        decimals: Number of decimal places to keep for each coordinate.

    Returns:
        List of [lat, lon] lists (JSON-serializable). Empty if points is empty.
    """
    if not points:
        return []
    return [[round(lat, decimals), round(lon, decimals)] for lat, lon in points]


def _nearest_point_index(
    polyline: list[tuple[float, float]],
    lat: float,
    lon: float,
) -> int:
    """
    Find the index of the polyline vertex closest to a geographic point.

    Linear argmin of the haversine distance over every vertex; used to snap a
    station to the nearest point on the route polyline.

    Args:
        polyline: Ordered list of (lat, lon) tuples.
        lat: Target point latitude in decimal degrees.
        lon: Target point longitude in decimal degrees.

    Returns:
        Index of the nearest vertex, or -1 if the polyline is empty.
    """
    if not polyline:
        return -1
    best_idx = 0
    best_dist = math.inf
    for i, (p_lat, p_lon) in enumerate(polyline):
        dist = haversine_km(lat, lon, p_lat, p_lon)
        if dist < best_dist:
            best_dist = dist
            best_idx = i
    return best_idx


def _extract_segment_points(
    route_data: dict,
    start_station: StationOnRoute,
    end_station: StationOnRoute,
) -> list[tuple[float, float]]:
    """
    Extract the route track points between two stations.

    Snaps each station to the nearest vertex of the route's 'track_points'
    polyline and returns the inclusive slice between those two indices. Slicing
    the same full-resolution polyline that is drawn guarantees the segment ends
    land on the route line next to the station markers, regardless of station
    spacing. The result is full-resolution (no downsampling).

    Args:
        route_data: Single route dict from the index (with 'track_points').
        start_station: Bike departure station (carries lat/lon).
        end_station: Bike arrival station (carries lat/lon).

    Returns:
        List of (lat, lon) tuples for the segment. Empty if track_points is
        absent.
    """
    raw_points = route_data.get("track_points")
    if not raw_points:
        return []
    polyline = [(p[0], p[1]) for p in raw_points]
    i1 = _nearest_point_index(polyline, start_station.lat, start_station.lon)
    i2 = _nearest_point_index(polyline, end_station.lat, end_station.lon)
    if i1 == -1 or i2 == -1:
        return []
    return polyline[min(i1, i2): max(i1, i2) + 1]


def find_itinerary_candidates(
    route_id: str,
    route_data: dict,
    departure_lat: float,
    departure_lon: float,
    n_days: int,
    rhythm_key: str,
) -> list[TripCandidate]:
    """
    Build TripCandidate list for a single Eurovelo route.

    For each outbound candidate station (up to OUTBOUND_CANDIDATE_COUNT):
    1. Compute the end station based on total biking km.
    2. Build the biked-segment geometry by slicing the route's full-resolution
       track_points between the start and end stations' nearest vertices
       (see _extract_segment_points), so the line spans station to station.
    3. Assemble a TripCandidate.

    Args:
        route_id: Eurovelo route identifier.
        route_data: Route dict from the proximity index.
        departure_lat: Latitude of the user's departure city.
        departure_lon: Longitude of the user's departure city.
        n_days: Total trip days.
        rhythm_key: Rhythm key string.

    Returns:
        List of TripCandidate objects. May be empty if no start stations exist.
    """
    rhythm = get_rhythm(rhythm_key)
    biking_km = total_biking_km(n_days, rhythm)
    route_name = route_data.get("name", route_id)

    outbound_candidates = get_stations_near_route_start(
        route_data, departure_lat, departure_lon, OUTBOUND_CANDIDATE_COUNT
    )
    if not outbound_candidates:
        return []

    candidates: list[TripCandidate] = []
    for start_station in outbound_candidates:
        end_station = compute_end_station(route_data, start_station, biking_km)
        if end_station is None:
            continue
        start_km = start_station.cumulative_km
        end_km = start_km + biking_km
        geometry = _extract_segment_points(route_data, start_station, end_station)
        candidates.append(
            TripCandidate(
                route_id=route_id,
                route_name=route_name,
                departure_station=start_station,
                arrival_station=end_station,
                biking_start_km=round(start_km, 1),
                biking_end_km=round(end_km, 1),
                total_biking_km=round(biking_km, 1),
                n_days=n_days,
                rhythm_key=rhythm_key,
                geometry=geometry,
            )
        )
    return candidates


def find_all_itineraries(
    route_ids: list[str],
    index: dict,
    departure_lat: float,
    departure_lon: float,
    n_days: int,
    rhythm_key: str,
) -> list[TripCandidate]:
    """
    Build TripCandidate lists for all requested Eurovelo routes.

    When a single route is requested, returns up to OUTBOUND_CANDIDATE_COUNT
    candidates. When multiple routes are requested, returns at most one
    candidate per route (the closest start station to the departure city).

    Args:
        route_ids: List of Eurovelo route identifiers to search.
        index: Full proximity index dict (from load_route_index()).
        departure_lat: Latitude of the user's departure city.
        departure_lon: Longitude of the user's departure city.
        n_days: Total trip days.
        rhythm_key: Rhythm key string.

    Returns:
        Flat list of TripCandidate objects across all routes. Empty if no
        candidates found.
    """
    routes = index.get("routes", {})
    multiple_routes = len(route_ids) > 1
    all_candidates: list[TripCandidate] = []

    for route_id in route_ids:
        if route_id not in routes:
            continue
        candidates = find_itinerary_candidates(
            route_id=route_id,
            route_data=routes[route_id],
            departure_lat=departure_lat,
            departure_lon=departure_lon,
            n_days=n_days,
            rhythm_key=rhythm_key,
        )
        if multiple_routes and candidates:
            # One result per route when multiple routes are selected
            all_candidates.append(candidates[0])
        else:
            all_candidates.extend(candidates)

    return all_candidates
