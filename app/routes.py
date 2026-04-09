"""
Flask route handlers for the Intercyclette web application.

Serves the HTML frontend and provides two JSON API endpoints:
  GET  /api/stations  — full station list for autocomplete
  POST /api/search    — itinerary search (calls Navitia, assembles cards)
"""

import json
import os
from dataclasses import asdict
from datetime import date

from flask import Flask, request, jsonify, render_template, Response

from app.constants import (
    EUROVELO_ROUTES,
    RHYTHMS,
    STATIONS_GEOJSON,
    PROCESSED_OUTPUT,
    MIN_DAYS,
    MAX_DAYS,
    OUTBOUND_CANDIDATE_COUNT,
    RETURN_CANDIDATE_COUNT,
)
from app.geo.station_matcher import load_stations
from app.itinerary.planner import (
    load_route_index,
    find_all_itineraries,
    TripCandidate,
)
from app.navitia.client import (
    load_config_from_env,
    fetch_outbound_journeys,
    fetch_return_journeys,
    NavitiaError,
)
from app.navitia.journey_parser import parse_best_journey, format_duration_minutes, JourneyResult


def _load_stations_for_autocomplete(geojson_path: str) -> list[dict]:
    """
    Load stations and convert to a minimal list suitable for autocomplete.

    Args:
        geojson_path: Path to the SNCF stations GeoJSON file.

    Returns:
        List of dicts with keys: nom, libellecourt, codes_uic (first code),
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


def validate_search_request(body: dict) -> tuple[bool, str]:
    """
    Validate the /api/search request body against schema constraints.

    Args:
        body: Parsed JSON dict from the request body.

    Returns:
        (is_valid, error_message). error_message is empty when is_valid is True.
    """
    departure_uic = body.get("departure_uic", "")
    if not departure_uic:
        return False, "departure_uic is required"

    n_days = body.get("n_days")
    if n_days is None:
        return False, "n_days is required"
    try:
        n_days = int(n_days)
    except (TypeError, ValueError):
        return False, "n_days must be an integer"
    if not (MIN_DAYS <= n_days <= MAX_DAYS):
        return False, f"n_days must be between {MIN_DAYS} and {MAX_DAYS}"

    rhythm = body.get("rhythm", "")
    if rhythm not in RHYTHMS:
        return False, f"rhythm must be one of: {list(RHYTHMS.keys())}"

    routes = body.get("routes", [])
    if not routes:
        return False, "At least one route must be selected"
    invalid = [r for r in routes if r not in EUROVELO_ROUTES]
    if invalid:
        return False, f"Unknown route IDs: {invalid}"

    travel_date = body.get("travel_date", "")
    if travel_date:
        try:
            date.fromisoformat(travel_date)
        except ValueError:
            return False, "travel_date must be in YYYY-MM-DD format"

    return True, ""


def _station_dict_by_uic(stations: list[dict], uic: str) -> dict | None:
    """
    Find a station dict by its UIC code from the preloaded autocomplete list.

    Args:
        stations: Preloaded list from _load_stations_for_autocomplete().
        uic: UIC code string to look up.

    Returns:
        The matching station dict, or None if not found.
    """
    for s in stations:
        if s["uic"] == uic:
            return s
    return None


def build_itinerary_card(
    candidate: TripCandidate,
    outbound_journey: JourneyResult | None,
    return_journey: JourneyResult | None,
) -> dict:
    """
    Assemble the JSON dict for one itinerary card for the frontend.

    Combines trip geometry, station names, biking distance, and journey
    schedule data into a single dict suitable for rendering.

    Args:
        candidate: TripCandidate with route and biking data.
        outbound_journey: Parsed outbound train journey (may be None if not found).
        return_journey: Parsed return train journey (may be None if not found).

    Returns:
        Dict with keys: route_id, route_name, departure_station, arrival_station,
        biking_start_km, biking_end_km, total_biking_km, n_days, rhythm_key,
        geometry, outbound, return_train.
    """
    def _journey_dict(j: JourneyResult | None) -> dict | None:
        if j is None:
            return None
        return {
            "from": j.from_station_nom,
            "to": j.to_station_nom,
            "departure": j.departure_datetime,
            "arrival": j.arrival_datetime,
            "duration": format_duration_minutes(j.duration_minutes),
            "duration_minutes": j.duration_minutes,
            "nb_transfers": j.nb_transfers,
            "sections": j.sections,
        }

    return {
        "route_id": candidate.route_id,
        "route_name": candidate.route_name,
        "departure_station": {
            "nom": candidate.departure_station.nom,
            "uic": candidate.departure_station.codes_uic[0] if candidate.departure_station.codes_uic else "",
            "lat": candidate.departure_station.lat,
            "lon": candidate.departure_station.lon,
            "cumulative_km": candidate.departure_station.cumulative_km,
        },
        "arrival_station": {
            "nom": candidate.arrival_station.nom,
            "uic": candidate.arrival_station.codes_uic[0] if candidate.arrival_station.codes_uic else "",
            "lat": candidate.arrival_station.lat,
            "lon": candidate.arrival_station.lon,
            "cumulative_km": candidate.arrival_station.cumulative_km,
        },
        "biking_start_km": candidate.biking_start_km,
        "biking_end_km": candidate.biking_end_km,
        "total_biking_km": candidate.total_biking_km,
        "n_days": candidate.n_days,
        "rhythm_key": candidate.rhythm_key,
        "geometry": candidate.geometry,
        "outbound": _journey_dict(outbound_journey),
        "return_train": _journey_dict(return_journey),
    }


def create_app(config: dict | None = None) -> Flask:
    """
    Flask application factory.

    Loads station list and route index at startup. Reads NAVITIA_TOKEN from
    the environment. Raises RuntimeError if the token is absent.

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

    # Resolve paths relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    geojson_path = os.path.join(project_root, STATIONS_GEOJSON)
    index_path = os.path.join(project_root, PROCESSED_OUTPUT)

    # Load data at startup (held in app config to allow testing overrides)
    if "STATIONS" not in app.config:
        app.config["STATIONS"] = _load_stations_for_autocomplete(geojson_path)

    if "ROUTE_INDEX" not in app.config:
        if os.path.isfile(index_path):
            app.config["ROUTE_INDEX"] = load_route_index(index_path)
        else:
            app.config["ROUTE_INDEX"] = None

    if "NAVITIA_CONFIG" not in app.config:
        try:
            app.config["NAVITIA_CONFIG"] = load_config_from_env()
        except RuntimeError:
            app.config["NAVITIA_CONFIG"] = None

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

    @app.route("/api/search", methods=["POST"])
    def search() -> Response:
        """
        Main itinerary search endpoint.

        Request body (JSON):
        {
          "departure_uic": "87313759",
          "n_days": 5,
          "rhythm": "randonneur",
          "routes": ["EV6"],
          "travel_date": "2026-04-12"    (optional, defaults to tomorrow)
        }

        Response: JSON array of itinerary card objects, or error dict.
        """
        body = request.get_json(force=True, silent=True) or {}
        is_valid, error_msg = validate_search_request(body)
        if not is_valid:
            return jsonify({"error": error_msg}), 400

        route_index = app.config.get("ROUTE_INDEX")
        if route_index is None:
            return jsonify({"error": "Route index not available. Run scripts/preprocess.py first."}), 503

        navitia_cfg = app.config.get("NAVITIA_CONFIG")
        if navitia_cfg is None:
            return jsonify({"error": "NAVITIA_TOKEN not configured."}), 503

        departure_uic = body["departure_uic"]
        n_days = int(body["n_days"])
        rhythm_key = body["rhythm"]
        route_ids = body["routes"]

        # Resolve departure city coordinates from the station list
        stations_list = app.config["STATIONS"]
        dep_station = _station_dict_by_uic(stations_list, departure_uic)
        if dep_station is None:
            return jsonify({"error": f"Station UIC '{departure_uic}' not found."}), 400

        dep_lat = dep_station["lat"]
        dep_lon = dep_station["lon"]

        # Resolve travel date
        travel_date_str = body.get("travel_date") or date.today().strftime("%Y%m%d")
        if "-" in travel_date_str:
            travel_date_str = travel_date_str.replace("-", "")

        # Find itinerary candidates (pure computation, no network)
        candidates = find_all_itineraries(
            route_ids=route_ids,
            index=route_index,
            departure_lat=dep_lat,
            departure_lon=dep_lon,
            n_days=n_days,
            rhythm_key=rhythm_key,
        )

        if not candidates:
            return jsonify([])

        # Fetch Navitia journeys for each candidate (6 calls per route)
        cards = []
        for candidate in candidates:
            outbound_uic = candidate.departure_station.codes_uic[0] if candidate.departure_station.codes_uic else ""
            return_uic = candidate.arrival_station.codes_uic[0] if candidate.arrival_station.codes_uic else ""

            if not outbound_uic or not return_uic:
                continue

            # Compute return date = travel_date + (n_days - 1)
            from datetime import timedelta
            start_date = date(
                int(travel_date_str[:4]),
                int(travel_date_str[4:6]),
                int(travel_date_str[6:8]),
            )
            return_date = (start_date + timedelta(days=n_days - 1)).strftime("%Y%m%d")

            outbound_responses = fetch_outbound_journeys(
                navitia_cfg, departure_uic, [outbound_uic], travel_date_str
            )
            return_responses = fetch_return_journeys(
                navitia_cfg, [return_uic], departure_uic, return_date
            )

            outbound_journey = parse_best_journey(outbound_responses[0]) if outbound_responses[0] else None
            return_journey = parse_best_journey(return_responses[0]) if return_responses[0] else None

            card = build_itinerary_card(candidate, outbound_journey, return_journey)
            cards.append(card)

        return jsonify(cards)

    return app
