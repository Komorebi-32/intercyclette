"""
Export SNCF stations to a static JSON file for the GitHub Pages frontend.

Reads data/raw/gares-de-voyageurs.geojson and writes
static/data/stations.json — a flat array of station objects used by the
autocomplete in search.js.

Usage:
    python3 scripts/export_stations_json.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.constants import STATIONS_GEOJSON
from app.geo.station_matcher import load_stations

OUTPUT_PATH = "static/data/stations.json"


def export_stations(geojson_path: str, output_path: str) -> int:
    """
    Load SNCF stations from GeoJSON and write a minimal JSON array for autocomplete.

    Each object in the output array has keys:
        nom (str): Station display name.
        libellecourt (str): 3-letter SNCF code.
        uic (str): First UIC code from codes_uic (used for Navitia API calls).
        lat (float): Station latitude.
        lon (float): Station longitude.

    Args:
        geojson_path: Path to gares-de-voyageurs.geojson.
        output_path: Destination path for the output JSON file.

    Returns:
        Number of stations written.

    Raises:
        FileNotFoundError: If geojson_path does not exist.
    """
    stations_raw = load_stations(geojson_path)
    stations_out = []

    for s in stations_raw:
        props = s.get("properties", {})
        coords = s.get("geometry", {}).get("coordinates", [None, None])
        codes_uic_str = props.get("codes_uic", "")
        uic_list = [c.strip() for c in codes_uic_str.split(";") if c.strip()]
        if not uic_list:
            continue

        stations_out.append(
            {
                "nom": props.get("nom", ""),
                "libellecourt": props.get("libellecourt", ""),
                "uic": uic_list[0],
                "lat": coords[1],
                "lon": coords[0],
            }
        )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(stations_out, f, ensure_ascii=False)

    return len(stations_out)


if __name__ == "__main__":
    count = export_stations(STATIONS_GEOJSON, OUTPUT_PATH)
    print(f"Wrote {count} stations to {OUTPUT_PATH}")
