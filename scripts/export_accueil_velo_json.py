"""
Preprocessing script: export Accueil Vélo housing and restaurant points.

Reads the Accueil Vélo CSV, filters rows by Sous-type ("Hébergement" for
housing, "Restauration" for restaurants), then for each Eurovelo GPX route
finds all matching establishments within HOUSING_PROXIMITY_KM km.  De-
duplicates by Identifiant (first occurrence wins) and writes two flat JSON
arrays to the static/data directory for the browser to fetch at runtime.

Usage:
    python3 scripts/export_accueil_velo_json.py
    python3 scripts/export_accueil_velo_json.py \\
        --csv data/raw/accueil-velo.csv \\
        --gpx-dir data/raw/Eurovelo_France_gpx \\
        --output-housing static/data/accueil_velo_housing.json \\
        --output-restaurants static/data/accueil_velo_restaurants.json \\
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
    ACCUEIL_VELO_CSV,
    ACCUEIL_VELO_HOUSING_OUTPUT,
    ACCUEIL_VELO_RESTAURANTS_OUTPUT,
    HOUSING_PROXIMITY_KM,
)
from app.geo.gpx_parser import parse_gpx_file
from app.geo.accueil_velo_matcher import (
    load_accueil_velo_csv,
    filter_by_sous_type,
    find_accueil_velo_near_route,
    serialize_accueil_velo_points,
)


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments for the export script.

    Returns:
        Namespace with csv, gpx_dir, output_housing, output_restaurants,
        and max_distance attributes.
    """
    parser = argparse.ArgumentParser(
        description="Export Accueil Vélo housing and restaurant points to JSON."
    )
    parser.add_argument("--csv", default=ACCUEIL_VELO_CSV)
    parser.add_argument("--gpx-dir", default=GPX_DIR)
    parser.add_argument("--output-housing", default=ACCUEIL_VELO_HOUSING_OUTPUT)
    parser.add_argument("--output-restaurants", default=ACCUEIL_VELO_RESTAURANTS_OUTPUT)
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


def collect_nearby_points(
    gpx_dir: str,
    rows: list[dict],
    max_distance_km: float,
) -> dict[str, dict]:
    """
    Find all Accueil Vélo points within max_distance_km of any Eurovelo route.

    Iterates over every route in EUROVELO_ROUTES, parses its GPX track, and
    accumulates results into a de-duplicated dict keyed by Identifiant.  When
    the same establishment appears near multiple routes, the first occurrence
    is kept.

    Args:
        gpx_dir: Absolute path to the directory containing GPX files.
        rows: Pre-filtered list of row dicts from load_accueil_velo_csv().
        max_distance_km: Distance threshold in km.

    Returns:
        Dict mapping Identifiant → serialised AccueilVeloPoint dict.
    """
    seen: dict[str, dict] = {}

    for route_id, route_info in EUROVELO_ROUTES.items():
        gpx_path = os.path.join(gpx_dir, route_info["file"])
        if not os.path.isfile(gpx_path):
            print(f"  [WARN] GPX file not found, skipping: {gpx_path}", flush=True)
            continue

        print(f"  Processing {route_id} …", flush=True)
        track = parse_gpx_file(gpx_path, route_id)
        nearby = find_accueil_velo_near_route(track, rows, max_distance_km)
        serialised = serialize_accueil_velo_points(nearby)

        for point in serialised:
            point_id = point.get("id", "")
            if point_id and point_id not in seen:
                seen[point_id] = point

    return seen


def write_output(output_path: str, points: list[dict]) -> None:
    """
    Write the flat JSON array of points to disk.

    Creates parent directories if they do not yet exist.

    Args:
        output_path: Absolute path for the output JSON file.
        points: List of JSON-serialisable point dicts.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False, indent=2)


def main() -> None:
    """
    Entry point: load CSV, filter by sous-type, match to routes, write outputs.
    """
    args = parse_args()

    csv_path              = resolve_path(args.csv)
    gpx_dir               = resolve_path(args.gpx_dir)
    output_housing_path   = resolve_path(args.output_housing)
    output_restaurants_path = resolve_path(args.output_restaurants)

    print(f"Loading Accueil Vélo CSV from: {csv_path}")
    all_rows = load_accueil_velo_csv(csv_path)
    print(f"  {len(all_rows)} rows loaded.")

    housing_rows = filter_by_sous_type(all_rows, "Hébergement")
    restaurant_rows = filter_by_sous_type(all_rows, "Restauration")
    print(f"  {len(housing_rows)} housing rows, {len(restaurant_rows)} restaurant rows.")

    print(f"\nMatching housing to Eurovelo routes (max {args.max_distance} km) …")
    housing_seen = collect_nearby_points(gpx_dir, housing_rows, args.max_distance)
    housing_result = list(housing_seen.values())

    print(f"\nMatching restaurants to Eurovelo routes (max {args.max_distance} km) …")
    restaurant_seen = collect_nearby_points(gpx_dir, restaurant_rows, args.max_distance)
    restaurant_result = list(restaurant_seen.values())

    print(f"\nWriting {len(housing_result)} housing points to: {output_housing_path}")
    write_output(output_housing_path, housing_result)

    print(f"Writing {len(restaurant_result)} restaurant points to: {output_restaurants_path}")
    write_output(output_restaurants_path, restaurant_result)

    print("Done.")


if __name__ == "__main__":
    main()
