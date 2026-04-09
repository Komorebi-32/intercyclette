"""
Preprocessing script: build the route-stations proximity index.

For each Eurovelo GPX route, finds all SNCF train stations within 5 km
of the route polyline and stores their cumulative position along the route.
The result is written to data/processed/route_stations.json.

Usage:
    python3 scripts/preprocess.py
    python3 scripts/preprocess.py --gpx-dir data/raw/Eurovelo_France_gpx \\
        --geojson data/raw/gares-de-voyageurs.geojson \\
        --output data/processed/route_stations.json \\
        --max-distance 5.0
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


# Allow running from project root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.constants import (
    EUROVELO_ROUTES,
    GPX_DIR,
    STATIONS_GEOJSON,
    PROCESSED_OUTPUT,
    STATION_PROXIMITY_KM,
)
from app.geo.gpx_parser import parse_gpx_file
from app.geo.station_matcher import (
    load_stations,
    find_stations_near_route,
    serialize_route_stations,
)


def write_index(index: dict, output_path: str) -> None:
    """
    Write the full proximity index dict to output_path as formatted JSON.

    Creates parent directories if they do not already exist.

    Args:
        index: Dict produced by build_route_stations_index().
        output_path: Destination file path (absolute or relative to cwd).
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def load_existing_index(output_path: str) -> dict | None:
    """
    Load an existing proximity index from disk, if present.

    Used to inspect a previous run or for incremental processing.

    Args:
        output_path: Path to the JSON file to attempt loading.

    Returns:
        Parsed dict if the file exists and is valid JSON; None otherwise.
    """
    if not os.path.isfile(output_path):
        return None
    try:
        with open(output_path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def build_route_stations_index(
    gpx_dir: str,
    geojson_path: str,
    output_path: str,
    max_distance_km: float,
) -> dict:
    """
    Build and persist the full route-stations proximity index.

    Pipeline:
    1. Load all SNCF stations from the GeoJSON file.
    2. For each route in EUROVELO_ROUTES:
       a. Parse the GPX file into a GpxTrack.
       b. Find all stations within max_distance_km of the route.
       c. Serialize the result to a dict.
    3. Assemble the full index and write it to output_path.

    Args:
        gpx_dir: Directory containing Eurovelo .gpx files.
        geojson_path: Path to the SNCF stations GeoJSON file.
        output_path: Destination path for the output JSON file.
        max_distance_km: Maximum station-to-route distance to include (km).

    Returns:
        The full index dict that was written to disk.

    Raises:
        FileNotFoundError: If gpx_dir or geojson_path do not exist.
    """
    print(f"Loading stations from {geojson_path}…")
    stations = load_stations(geojson_path)
    print(f"  {len(stations)} stations loaded.")

    routes_index: dict[str, dict] = {}

    for route_id, route_meta in EUROVELO_ROUTES.items():
        gpx_path = os.path.join(gpx_dir, route_meta["file"])
        if not os.path.isfile(gpx_path):
            print(f"  [SKIP] {route_id}: file not found at {gpx_path}")
            continue

        print(f"Processing {route_id} — {route_meta['name']}…")
        track = parse_gpx_file(gpx_path, route_id)
        print(f"  {len(track.points):,} track points, {track.total_km:.1f} km total.")

        nearby = find_stations_near_route(track, stations, max_distance_km)
        print(f"  {len(nearby)} station(s) within {max_distance_km} km.")

        routes_index[route_id] = serialize_route_stations(
            route_id=route_id,
            name=route_meta["name"],
            total_km=track.total_km,
            stations=nearby,
        )

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "max_distance_km": max_distance_km,
        "routes": routes_index,
    }

    write_index(index, output_path)
    print(f"\nIndex written to {output_path}")
    return index


def _parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments for the preprocessing script.

    Returns:
        Namespace with gpx_dir, geojson, output, max_distance attributes.
    """
    parser = argparse.ArgumentParser(
        description="Build the Eurovelo route-stations proximity index."
    )
    parser.add_argument(
        "--gpx-dir",
        default=GPX_DIR,
        help=f"Directory with Eurovelo GPX files (default: {GPX_DIR})",
    )
    parser.add_argument(
        "--geojson",
        default=STATIONS_GEOJSON,
        help=f"Path to gares-de-voyageurs.geojson (default: {STATIONS_GEOJSON})",
    )
    parser.add_argument(
        "--output",
        default=PROCESSED_OUTPUT,
        help=f"Output JSON file path (default: {PROCESSED_OUTPUT})",
    )
    parser.add_argument(
        "--max-distance",
        type=float,
        default=STATION_PROXIMITY_KM,
        help=f"Max station-to-route distance in km (default: {STATION_PROXIMITY_KM})",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    build_route_stations_index(
        gpx_dir=args.gpx_dir,
        geojson_path=args.geojson,
        output_path=args.output,
        max_distance_km=args.max_distance,
    )
