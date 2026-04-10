"""
Minimal proxy server for Intercyclette.

Forwards Navitia journey requests from the static frontend to
api.navitia.io, keeping the NAVITIA_TOKEN out of the browser.

The token is read from the NAVITIA_TOKEN environment variable.

Endpoints:
    POST /navitia/journey  — accepts JSON body, returns Navitia JSON

Usage:
    NAVITIA_TOKEN=your_token python3 proxy/app.py        # development
    NAVITIA_TOKEN=your_token gunicorn app:app             # production
"""

import os

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

NAVITIA_TOKEN = os.environ.get("NAVITIA_TOKEN", "")
NAVITIA_BASE_URL = "https://api.navitia.io/v1"
NAVITIA_TIMEOUT_SECONDS = 10


@app.after_request
def add_cors_headers(response):
    """
    Add CORS headers to every response so GitHub Pages can call this proxy.

    Args:
        response: Flask Response object.

    Returns:
        The same response with Access-Control-* headers added.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@app.route("/navitia/journey", methods=["POST", "OPTIONS"])
def journey():
    """
    Forward a journey lookup to the Navitia API.

    Expects JSON body:
        from_uic (str): UIC code of the departure station.
        to_uic (str): UIC code of the arrival station.
        datetime_str (str): Navitia datetime string, e.g. "20260501T080000".

    Returns:
        JSON response from Navitia with the original HTTP status code.
        Returns 400 if a required field is missing.
        Returns 500 if NAVITIA_TOKEN is not configured.
    """
    if request.method == "OPTIONS":
        return "", 204

    if not NAVITIA_TOKEN:
        return jsonify({"error": "NAVITIA_TOKEN not configured on proxy server"}), 500

    body = request.get_json(force=True) or {}
    from_uic = body.get("from_uic", "")
    to_uic = body.get("to_uic", "")
    datetime_str = body.get("datetime_str", "")

    if not from_uic or not to_uic or not datetime_str:
        return jsonify({"error": "Missing required field: from_uic, to_uic, datetime_str"}), 400

    url = (
        f"{NAVITIA_BASE_URL}/journeys"
        f"?from=stop_area:SNCF:{from_uic}"
        f"&to=stop_area:SNCF:{to_uic}"
        f"&datetime={datetime_str}"
    )

    navitia_response = requests.get(
        url,
        auth=(NAVITIA_TOKEN, ""),
        timeout=NAVITIA_TIMEOUT_SECONDS,
    )

    return jsonify(navitia_response.json()), navitia_response.status_code


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
