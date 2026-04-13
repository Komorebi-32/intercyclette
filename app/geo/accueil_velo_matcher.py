"""
Accueil Vélo CSV proximity matching.

Loads accommodation and restaurant entries from the Accueil Vélo CSV dataset,
filters them by the first "Sous-type" column, and returns only those within a
configurable distance of an Eurovelo route polyline.  Proximity search is
delegated to find_features_near_route() in station_matcher.py so no distance
logic is duplicated.

The CSV has two columns both named "Sous-type".  Only the first occurrence is
used (it holds the top-level category: "Hébergement", "Restauration", etc.).
"""

import csv
from dataclasses import dataclass, asdict

from app.geo.gpx_parser import GpxTrack
from app.geo.station_matcher import find_features_near_route


@dataclass
class AccueilVeloPoint:
    """
    A labelled Accueil Vélo establishment near an Eurovelo route.

    Attributes:
        id: Establishment identifier from the "Identifiant" column.
            Used for cross-route deduplication.
        name: Establishment name. May be None if the CSV field is empty.
        website: First URL from the "Site internet" field. May be None.
        lat: Latitude, decimal degrees.
        lon: Longitude, decimal degrees.
        distance_to_route_km: Shortest distance to the route polyline, in km.
    """

    id: str
    name: str | None
    website: str | None
    lat: float
    lon: float
    distance_to_route_km: float


def load_accueil_velo_csv(csv_path: str) -> list[dict]:
    """
    Load all rows from the Accueil Vélo CSV file as a list of dicts.

    The CSV contains two columns both named "Sous-type".  Only the first
    occurrence is preserved in the returned dicts under the key "Sous-type".
    All other columns are stored under their original header name.

    Args:
        csv_path: Path to the CSV file (absolute or relative to cwd).

    Returns:
        List of row dicts, one per data row (header excluded).
        Empty list if the file contains only the header.

    Raises:
        FileNotFoundError: If the file does not exist.
    """
    rows: list[dict] = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        raw_headers = next(reader)

        # Build a deduplicated header list: first "Sous-type" wins;
        # subsequent duplicates are skipped (mapped to None sentinel).
        seen_sous_type = False
        headers: list[str | None] = []
        for col in raw_headers:
            if col == "Sous-type":
                if not seen_sous_type:
                    headers.append(col)
                    seen_sous_type = True
                else:
                    headers.append(None)  # skip second occurrence
            else:
                headers.append(col)

        for raw_row in reader:
            row: dict = {}
            for col_name, value in zip(headers, raw_row):
                if col_name is not None:
                    row[col_name] = value
            rows.append(row)

    return rows


def filter_by_sous_type(rows: list[dict], keyword: str) -> list[dict]:
    """
    Return rows whose first "Sous-type" value contains keyword.

    Matching is case-insensitive substring search.

    Args:
        rows: List of row dicts from load_accueil_velo_csv().
        keyword: Substring to search for (e.g. "Hébergement", "Restauration").

    Returns:
        Filtered list of row dicts.  Empty list if no rows match.
    """
    keyword_lower = keyword.lower()
    return [
        row for row in rows
        if keyword_lower in row.get("Sous-type", "").lower()
    ]


def _extract_first_url(raw: str) -> str | None:
    """
    Return the first non-empty URL from a comma-separated URL string.

    Args:
        raw: Raw "Site internet" cell value (may contain multiple URLs
             separated by commas, or be empty).

    Returns:
        The first URL as a string, or None if the field is blank.
    """
    if not raw:
        return None
    for part in raw.split(","):
        url = part.strip()
        if url:
            return url
    return None


def _row_to_feature(row: dict) -> dict | None:
    """
    Convert a CSV row dict to a minimal GeoJSON feature dict.

    The returned dict is compatible with find_features_near_route() from
    station_matcher, which expects GeoJSON Point features.  Returns None
    if the row's lat/lon values are missing or non-numeric.

    Args:
        row: A row dict from load_accueil_velo_csv().

    Returns:
        GeoJSON feature dict with Point geometry and relevant properties,
        or None if the coordinates cannot be parsed.
    """
    try:
        lat = float(row["Latitude"])
        lon = float(row["Longitude"])
    except (KeyError, ValueError, TypeError):
        return None

    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id":      row.get("Identifiant", ""),
            "name":    row.get("Nom") or None,
            "website": _extract_first_url(row.get("Site internet", "")),
        },
    }


def find_accueil_velo_near_route(
    track: GpxTrack,
    rows: list[dict],
    max_distance_km: float,
) -> list[AccueilVeloPoint]:
    """
    Return AccueilVeloPoint objects within max_distance_km of the route polyline.

    Rows with invalid coordinates are silently skipped.  Proximity search is
    delegated to find_features_near_route() to avoid duplicating distance logic.

    Args:
        track: Parsed GPX track to check against.
        rows: List of row dicts from load_accueil_velo_csv() (pre-filtered).
        max_distance_km: Maximum allowed distance from establishment to route.

    Returns:
        List of AccueilVeloPoint, sorted ascending by cumulative_km along the
        route.  Empty list if no rows are within range.
    """
    features = [_row_to_feature(row) for row in rows]
    valid_features = [f for f in features if f is not None]

    nearby = find_features_near_route(track, valid_features, max_distance_km)

    points: list[AccueilVeloPoint] = []
    for feat, dist_km, _ in nearby:
        props = feat["properties"]
        coords = feat["geometry"]["coordinates"]
        points.append(AccueilVeloPoint(
            id=props.get("id", ""),
            name=props.get("name"),
            website=props.get("website"),
            lat=coords[1],
            lon=coords[0],
            distance_to_route_km=dist_km,
        ))
    return points


def serialize_accueil_velo_points(points: list[AccueilVeloPoint]) -> list[dict]:
    """
    Convert a list of AccueilVeloPoint objects to JSON-serialisable dicts.

    Args:
        points: List of AccueilVeloPoint dataclass instances.

    Returns:
        List of plain dicts suitable for json.dumps().  Null fields are kept
        as None (serialised as JSON null).
    """
    return [asdict(p) for p in points]
