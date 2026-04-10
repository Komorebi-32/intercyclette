"""
Export Eurovelo route geometries to per-route static JSON files.

Reads each GPX file and writes static/data/routes/{route_id_lower}.json —
one file per route — used by map.js to draw always-on colored polylines.

Each output file has the shape:
    {
      "route_id": "EV3",
      "name": "La Scandibérique",
      "color": "#e74c3c",
      "points": [[lat, lon], ...]
    }

Usage:
    python3 scripts/export_route_geometries.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.constants import EUROVELO_ROUTES, GPX_DIR, ROUTE_COLORS, ROUTE_DISPLAY_MAX_POINTS
from app.geo.gpx_parser import parse_gpx_file
from app.itinerary.planner import downsample_geometry

OUTPUT_DIR = "static/data/routes"


def export_route(route_id: str, route_meta: dict, gpx_dir: str, output_dir: str) -> str:
    """
    Parse one GPX route and write its downsampled geometry to a JSON file.

    Args:
        route_id: Eurovelo route key, e.g. "EV3".
        route_meta: Dict with 'name' and 'file' keys from EUROVELO_ROUTES.
        gpx_dir: Directory containing the .gpx files.
        output_dir: Directory where output JSON files are written.

    Returns:
        Path of the written file.

    Raises:
        FileNotFoundError: If the GPX file for this route does not exist.
    """
    gpx_path = os.path.join(gpx_dir, route_meta["file"])
    track = parse_gpx_file(gpx_path, route_id)
    points = downsample_geometry(track.points, ROUTE_DISPLAY_MAX_POINTS)

    payload = {
        "route_id": route_id,
        "name": route_meta["name"],
        "color": ROUTE_COLORS[route_id],
        "points": points,
    }

    filename = route_id.lower() + ".json"
    out_path = os.path.join(output_dir, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    return out_path


def export_all_routes(gpx_dir: str, output_dir: str) -> list[str]:
    """
    Export geometry files for all routes in EUROVELO_ROUTES.

    Skips routes whose GPX file is not found and prints a warning.

    Args:
        gpx_dir: Directory containing .gpx files.
        output_dir: Destination directory for output JSON files.

    Returns:
        List of paths of successfully written files.
    """
    os.makedirs(output_dir, exist_ok=True)
    written = []

    for route_id, route_meta in EUROVELO_ROUTES.items():
        gpx_path = os.path.join(gpx_dir, route_meta["file"])
        if not os.path.isfile(gpx_path):
            print(f"  [SKIP] {route_id}: GPX not found at {gpx_path}")
            continue
        out_path = export_route(route_id, route_meta, gpx_dir, output_dir)
        print(f"  {route_id} → {out_path}")
        written.append(out_path)

    return written


if __name__ == "__main__":
    print(f"Exporting route geometries to {OUTPUT_DIR}/…")
    paths = export_all_routes(GPX_DIR, OUTPUT_DIR)
    print(f"Done. {len(paths)} file(s) written.")
