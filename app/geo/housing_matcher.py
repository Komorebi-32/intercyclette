"""
Housing-to-route proximity matching.

Loads accommodation features from a GeoJSON FeatureCollection and returns those
within a configurable distance of an Eurovelo route polyline.  Delegates the
generic proximity search to find_features_near_route() in station_matcher.py so
no distance logic is duplicated.
"""

import json
from dataclasses import dataclass, asdict

from app.geo.gpx_parser import GpxTrack
from app.geo.station_matcher import find_features_near_route, _extract_lat_lon


@dataclass
class HousingPoint:
    """
    An accommodation point that lies within proximity of an Eurovelo route.

    Attributes:
        osm_id: OpenStreetMap feature identifier (e.g. 'node/123456789').
        type: Accommodation type (e.g. 'hotel', 'camp_site'). May be None.
        name: Establishment name. May be None.
        website: Website URL. May be None.
        phone: Phone number string. May be None.
        lat: Latitude, decimal degrees.
        lon: Longitude, decimal degrees.
        distance_to_route_km: Shortest distance to the route polyline, in km.
    """

    osm_id: str
    type: str | None
    name: str | None
    website: str | None
    phone: str | None
    lat: float
    lon: float
    distance_to_route_km: float


def load_housing(geojson_path: str) -> list[dict]:
    """
    Load all housing features from a GeoJSON FeatureCollection file.

    Expects a FeatureCollection of Point features.  Each feature may carry
    OSM tags (tourism, name, website, phone) as properties.

    Args:
        geojson_path: Path to the GeoJSON file (absolute or relative to cwd).

    Returns:
        List of raw GeoJSON feature dicts, one per accommodation point.

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


def _feature_to_housing_point(
    feature: dict,
    distance_to_route_km: float,
) -> HousingPoint:
    """
    Convert a GeoJSON feature dict and its route distance to a HousingPoint.

    Args:
        feature: GeoJSON feature dict. Point geometry [lon, lat], or Polygon /
                 MultiPolygon whose centroid is used as the representative point.
        distance_to_route_km: Precomputed distance to the route, in km.

    Returns:
        HousingPoint populated from the feature's properties and geometry.
    """
    props = feature.get("properties", {})
    lat_lon = _extract_lat_lon(feature)
    lat, lon = lat_lon if lat_lon is not None else (0.0, 0.0)
    return HousingPoint(
        osm_id=props.get("osm_id", ""),
        type=props.get("tourism") or None,
        name=props.get("name") or None,
        website=props.get("website") or None,
        phone=props.get("phone") or None,
        lat=lat,
        lon=lon,
        distance_to_route_km=distance_to_route_km,
    )


def find_housing_near_route(
    track: GpxTrack,
    housing: list[dict],
    max_distance_km: float,
) -> list[HousingPoint]:
    """
    Return HousingPoint objects within max_distance_km of the route polyline.

    Delegates proximity search to find_features_near_route() and wraps the
    resulting tuples into typed HousingPoint dataclass instances.

    Args:
        track: Parsed GPX track to check against.
        housing: List of raw GeoJSON feature dicts from load_housing().
        max_distance_km: Maximum allowed distance from feature to route, in km.

    Returns:
        List of HousingPoint, sorted ascending by cumulative_km along the route.
        Empty list if no features are within range or housing is empty.
    """
    nearby = find_features_near_route(track, housing, max_distance_km)
    return [_feature_to_housing_point(feat, dist_km) for feat, dist_km, _ in nearby]


def serialize_housing_points(points: list[HousingPoint]) -> list[dict]:
    """
    Convert a list of HousingPoint objects to JSON-serialisable dicts.

    Args:
        points: List of HousingPoint dataclass instances.

    Returns:
        List of plain dicts suitable for json.dumps().  Null fields are kept
        as None (serialised as JSON null).
    """
    return [asdict(p) for p in points]
