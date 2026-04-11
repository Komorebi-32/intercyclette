"""
Application-wide constants for Intercyclette.

All magic numbers, route definitions, and configuration values are declared
here. No literal values should appear elsewhere in the codebase.
"""

# ---------------------------------------------------------------------------
# Eurovelo route registry
# ---------------------------------------------------------------------------

EUROVELO_ROUTES = {
    "EV3": {
        "name": "La Scandibérique",
        "file": "la-scandiberique-eurovelo-3.gpx",
    },
    "EV4": {
        "name": "La Vélomaritime",
        "file": "la-velomaritime-eurovelo-4.gpx",
    },
    "EV5": {
        "name": "Eurovelo 5 Moselle Alsace",
        "file": "eurovelo-5-moselle-alsace.gpx",
    },
    "EV6": {
        "name": "Entre Rhin et Loire à Vélo",
        "file": "entre-rhin-et-loire-a-velo-eurovelo-6.gpx",
    },
    "EV8": {
        "name": "La Méditerranée à Vélo",
        "file": "la-mediterranee-a-velo-eurovelo-8.gpx",
    },
    "EV15": {
        "name": "Véloroute du Rhin",
        "file": "eurovelo-15-veloroute-rhin.gpx",
    },
    "EV19": {
        "name": "La Meuse à Vélo",
        "file": "eurovelo-19-la-meuse-a-velo.gpx",
    },
    "VEL": {
        "name": "La Vélodyssée",
        "file": "la-velodyssee.gpx",
    },
    "VIA": {
        "name": "ViaRhôna",
        "file": "viarhona.gpx",
    },
}

# ---------------------------------------------------------------------------
# Biking rhythms
# ---------------------------------------------------------------------------
# km/day: escargot=60, randonneur=97.5, athlete=160

RHYTHMS = {
    "escargot": {
        "label": "Escargot tranquille",
        "speed_kmh": 12.0,
        "hours_per_day": 5.0,
    },
    "randonneur": {
        "label": "Habitué des randovélo",
        "speed_kmh": 15.0,
        "hours_per_day": 6.5,
    },
    "athlete": {
        "label": "Athlète olympique",
        "speed_kmh": 20.0,
        "hours_per_day": 8.0,
    },
}

# ---------------------------------------------------------------------------
# Pre-processing / station matching
# ---------------------------------------------------------------------------

STATION_PROXIMITY_KM = 5.0
# First 15% of route (capped at ROUTE_START_ZONE_MAX_KM) is the "start zone"
# from which outbound candidate stations are drawn.
ROUTE_START_ZONE_FRACTION = 0.15
ROUTE_START_ZONE_MAX_KM = 100.0

OUTBOUND_CANDIDATE_COUNT = 3
RETURN_CANDIDATE_COUNT = 3

# Bounding-box margin added around each station when pre-filtering route
# segments. 0.1° ≈ 11 km, providing adequate buffer beyond STATION_PROXIMITY_KM.
BBOX_MARGIN_DEG = 0.1

# ---------------------------------------------------------------------------
# Itinerary computation
# ---------------------------------------------------------------------------

MIN_DAYS = 1
MAX_DAYS = 15
# Combined fraction of a full biking day lost to outbound + return train travel.
# Day 1 morning = train out; last day afternoon = train back → total ~1 day.
HALF_DAY_FRACTION = 0.5

# ---------------------------------------------------------------------------
# Geometry / map
# ---------------------------------------------------------------------------

EARTH_RADIUS_KM = 6371.0
# Maximum number of [lat, lon] points sent to the browser per itinerary
# segment (downsampled from raw GPX).
MAP_GEOMETRY_MAX_POINTS = 1000
# Number of track points embedded per route in route_stations.json for the
# always-on map overlay (fewer than MAP_GEOMETRY_MAX_POINTS since all 9 routes
# are loaded simultaneously).
ROUTE_DISPLAY_MAX_POINTS = 300

# ---------------------------------------------------------------------------
# Route display colors (map overlay + checkbox labels + itinerary badges)
# ---------------------------------------------------------------------------

ROUTE_COLORS = {
    "EV3":  "#e74c3c",   # red
    "EV4":  "#3498db",   # blue
    "EV5":  "#e67e22",   # orange
    "EV6":  "#9b59b6",   # purple
    "EV8":  "#1abc9c",   # teal
    "EV15": "#f39c12",   # amber
    "EV19": "#2ecc71",   # green
    "VEL":  "#e91e63",   # pink
    "VIA":  "#00bcd4",   # cyan
}

# ---------------------------------------------------------------------------
# File paths (relative to project root)
# ---------------------------------------------------------------------------

GPX_DIR          = "data/raw/Eurovelo_France_gpx"
STATIONS_GEOJSON = "data/raw/gares-de-voyageurs.geojson"
PROCESSED_OUTPUT = "data/processed/route_stations.json"
