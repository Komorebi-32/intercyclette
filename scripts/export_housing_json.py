"""
Preprocessing script: export accommodation points near Eurovelo routes.

Loads housing features from housing.geojson, then for each Eurovelo GPX route
finds all points within HOUSING_PROXIMITY_KM km. De-duplicates by osm_id
(first occurrence wins) and writes a flat JSON array to static/data/housing.json
for the browser to fetch at runtime.

Usage:
    python3 scripts/export_housing_json.py
    python3 scripts/export_housing_json.py --gpx-dir data/raw/Eurovelo_France_gpx \\
        --housing data/raw/housing.geojson \\
        --output static/data/housing.json \\
        --max-distance 5.0
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.constants import (
    EUROVELO_ROUTES,
    GPX_DIR,
    HOUSING_GEOJSON,
    HOUSING_OUTPUT,
    HOUSING_PROXIMITY_KM,
)
from app.geo.gpx_parser import parse_gpx_file
from app.geo.housing_matcher import (
    load_housing,
    find_housing_near_route,
    serialize_housing_points,
)


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments for the export script.

    Returns:
        Namespace with gpx_dir, housing, output, and max_distance attributes.
    """
    parser = argparse.ArgumentParser(
        description="Export housing points near Eurovelo routes to JSON."
    )
    parser.add_argument("--gpx-dir", default=GPX_DIR)
    parser.add_argument("--housing", default=HOUSING_GEOJSON)
    parser.add_argument("--output", default=HOUSING_OUTPUT)
    parser.add_argument("--max-distance", type=float, default=HOUSING_PROXIMITY_KM)
    return parser.parse_args()


def resolve_path(relative: str) -> str:
    """
    Resolve a path relative to the project root (parent of this script's dir).

    Args:
        relative: Path string relative to the project root.

    Returns:
        Absolute path string.
    """
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(project_root, relative)


def collect_nearby_housing(
    gpx_dir: str,
    housing_features: list[dict],
    max_distance_km: float,
) -> dict[str, dict]:
    """
    Find all housing points within max_distance_km of any Eurovelo route.

    Iterates over every route in EUROVELO_ROUTES, parses its GPX track, and
    accumulates results into a de-duplicated dict keyed by osm_id.  When the
    same point appears near multiple routes, the first occurrence is kept.

    Args:
        gpx_dir: Absolute path to the directory containing GPX files.
        housing_features: List of raw GeoJSON feature dicts from load_housing().
        max_distance_km: Distance threshold in km.

    Returns:
        Dict mapping osm_id → serialised housing point dict (JSON-ready).
    """
    seen: dict[str, dict] = {}

    for route_id, route_info in EUROVELO_ROUTES.items():
        gpx_path = os.path.join(gpx_dir, route_info["file"])
        if not os.path.isfile(gpx_path):
            print(f"  [WARN] GPX file not found, skipping: {gpx_path}", flush=True)
            continue

        print(f"  Processing {route_id} …", flush=True)
        track = parse_gpx_file(gpx_path, route_id)
        nearby = find_housing_near_route(track, housing_features, max_distance_km)
        serialised = serialize_housing_points(nearby)

        for point in serialised:
            osm_id = point.get("osm_id", "")
            if osm_id and osm_id not in seen:
                seen[osm_id] = point

    return seen


def write_output(output_path: str, points: list[dict]) -> None:
    """
    Write the flat JSON array of housing points to disk.

    Creates parent directories if they do not yet exist.

    Args:
        output_path: Absolute path for the output JSON file.
        points: List of JSON-serialisable housing point dicts.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False, indent=2)


def main() -> None:
    """
    Entry point: load housing data, match to routes, write JSON output.
    """
    args = parse_args()

    gpx_dir = resolve_path(args.gpx_dir)
    housing_path = resolve_path(args.housing)
    output_path = resolve_path(args.output)

    print(f"Loading housing features from: {housing_path}")
    housing_features = load_housing(housing_path)
    print(f"  {len(housing_features)} features loaded.")

    print(f"Matching to Eurovelo routes (max {args.max_distance} km) …")
    seen = collect_nearby_housing(gpx_dir, housing_features, args.max_distance)
    result = list(seen.values())

    print(f"Writing {len(result)} de-duplicated points to: {output_path}")
    write_output(output_path, result)
    print("Done.")


if __name__ == "__main__":
    main()
