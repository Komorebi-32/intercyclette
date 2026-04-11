"""
Flask route handlers for the Intercyclette web application.

Serves the HTML frontend and provides one JSON API endpoint:
  GET  /api/stations  — full station list for front-end autocomplete

The itinerary search is handled entirely in the browser using the Transitous
API.  The /api/search endpoint
and all Navitia dependencies have been removed.
"""

import os

from flask import Flask, jsonify, render_template, Response

from app.constants import (
    EUROVELO_ROUTES,
    RHYTHMS,
    STATIONS_GEOJSON,
)
from app.geo.station_matcher import load_stations


def _load_stations_for_autocomplete(geojson_path: str) -> list[dict]:
    """
    Load stations and convert to a minimal list suitable for autocomplete.

    Args:
        geojson_path: Path to the SNCF stations GeoJSON file.

    Returns:
        List of dicts with keys: nom, libellecourt, uic (first code),
        lat, lon — one entry per station.
    """
    features = load_stations(geojson_path)
    result = []
    for f in features:
        props = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        uics = props.get("codes_uic", "")
        first_uic = uics.split(";")[0].strip() if uics else ""
        if not first_uic:
            continue
        result.append({
            "nom": props.get("nom", ""),
            "libellecourt": props.get("libellecourt", ""),
            "uic": first_uic,
            "lat": float(coords[1]),
            "lon": float(coords[0]),
        })
    return result


def create_app(config: dict | None = None) -> Flask:
    """
    Flask application factory.

    Loads the station list at startup for the autocomplete endpoint.

    Args:
        config: Optional dict of Flask configuration overrides (for testing).

    Returns:
        Configured Flask application instance.
    """
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(__file__), "..", "templates"),
        static_folder=os.path.join(os.path.dirname(__file__), "..", "static"),
    )

    if config:
        app.config.update(config)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    geojson_path = os.path.join(project_root, STATIONS_GEOJSON)

    if "STATIONS" not in app.config:
        app.config["STATIONS"] = _load_stations_for_autocomplete(geojson_path)

    @app.route("/")
    def index() -> str:
        """Serve the main single-page HTML application."""
        return render_template("index.html", eurovelo_routes=EUROVELO_ROUTES, rhythms=RHYTHMS)

    @app.route("/api/stations")
    def stations() -> Response:
        """
        Return the full list of SNCF stations for autocomplete.

        Response: JSON array of {nom, libellecourt, uic, lat, lon} objects.
        """
        return jsonify(app.config["STATIONS"])

    return app
