"""
GPX file parser for Eurovelo route tracks.

Reads GPX files produced by Loopi (namespace http://www.topografix.com/GPX/1/1)
and converts them into GpxTrack dataclasses. Uses stdlib xml.etree.ElementTree
— no external dependencies required.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.geo.distance import cumulative_distances_km

GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1"
GPX_NS = {"gpx": GPX_NAMESPACE}


@dataclass
class GpxTrack:
    """
    A parsed GPX track.

    Attributes:
        route_id: Identifier string matching a key in EUROVELO_ROUTES
                  (e.g. "EV15").
        name: Human-readable track name extracted from the <trk><name> element.
        points: Ordered list of (lat, lon) tuples in WGS84 decimal degrees.
        total_km: Total length of the track in km.
    """

    route_id: str
    name: str
    points: list[tuple[float, float]]
    total_km: float


def extract_track_points(
    root: ET.Element,
    ns: dict[str, str],
) -> list[tuple[float, float]]:
    """
    Extract all <trkpt> lat/lon pairs from a parsed GPX XML root element.

    Args:
        root: The root <gpx> element returned by ET.parse().getroot().
        ns: XML namespace mapping dict, e.g. {"gpx": "http://..."}.

    Returns:
        Ordered list of (lat, lon) tuples. Never empty if the file is valid.

    Raises:
        ValueError: If no track points are found in the file.
    """
    points: list[tuple[float, float]] = []
    for trkpt in root.findall(".//gpx:trkpt", ns):
        lat = float(trkpt.attrib["lat"])
        lon = float(trkpt.attrib["lon"])
        points.append((lat, lon))
    if not points:
        raise ValueError("No track points (<trkpt>) found in GPX file")
    return points


def _extract_track_name(root: ET.Element, ns: dict[str, str]) -> str:
    """
    Extract the track name from the first <trk><name> element.

    Args:
        root: The root <gpx> element.
        ns: XML namespace mapping dict.

    Returns:
        Track name string. Returns empty string if <name> is absent or empty.
    """
    name_el = root.find(".//gpx:trk/gpx:name", ns)
    if name_el is not None and name_el.text:
        return name_el.text.strip()
    return ""


def parse_gpx_file(file_path: str, route_id: str) -> GpxTrack:
    """
    Parse a GPX file into a GpxTrack dataclass.

    Reads only <trkpt lat lon> elements. Elevation data is ignored.
    Computes total_km by summing haversine distances between consecutive points.

    Args:
        file_path: Path to the .gpx file (absolute or relative to cwd).
        route_id: Identifier string to embed in the returned GpxTrack.

    Returns:
        GpxTrack with points list and pre-computed total_km.

    Raises:
        FileNotFoundError: If file_path does not exist.
        ET.ParseError: If the file is not valid XML.
        ValueError: If no track points are found.
    """
    tree = ET.parse(file_path)
    root = tree.getroot()
    points = extract_track_points(root, GPX_NS)
    name = _extract_track_name(root, GPX_NS)
    cumulative = cumulative_distances_km(points)
    total_km = cumulative[-1]
    return GpxTrack(route_id=route_id, name=name, points=points, total_km=total_km)
