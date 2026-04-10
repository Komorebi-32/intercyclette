# Architecture

## Overview

Intercyclette is a static web application deployable on GitHub Pages. A minimal
proxy server (deployable on Render.com or Railway free tier) keeps the SNCF /
Navitia API token out of the browser.

```
┌─────────────────────────────────────────────────────────────────────┐
│  GitHub Pages (static)                                              │
│                                                                     │
│  index.html                    ─── single HTML page, no server     │
│  static/css/style.css                                               │
│  static/js/                                                         │
│    map.js            Leaflet map, colored route overlays            │
│    planner.js        JS port of Python itinerary planner            │
│    journey_parser.js JS port of Navitia JSON parser                 │
│    results.js        Render itinerary cards                         │
│    search.js         Form, autocomplete, orchestrates search        │
│  static/data/                                                       │
│    stations.json           All SNCF stations (autocomplete)         │
│    route_stations.json     Route–station proximity index            │
│    routes/                 One JSON per Eurovelo route              │
│      ev3.json, ev4.json, … (9 files, colored polylines)            │
└────────────────────────┬────────────────────────────────────────────┘
                         │  POST /navitia/journey  (CORS)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Proxy server  (Render.com / Railway free tier)                     │
│                                                                     │
│  proxy/app.py   ~40-line Flask server                               │
│    NAVITIA_TOKEN stored as environment variable (never in browser)  │
│    Forwards journey requests to api.navitia.io                      │
└────────────────────────┬────────────────────────────────────────────┘
                         │  GET /journeys?from=…&to=…&datetime=…
                         ▼
                   api.navitia.io  (SNCF train data)
```

---

## Data Flow

### 1. Page Load

```
browser
  ├─ fetch static/data/stations.json      → populate autocomplete
  └─ fetch static/data/route_stations.json → load route index into memory
     fetch static/data/routes/ev*.json (×9) → draw colored polylines on map
```

### 2. Search

```
user fills form → search.js reads form values
  │
  ▼
planner.js.findAllItineraries(routeIds, index, depLat, depLon, nDays, rhythm)
  │  pure JS, no network — reads route_stations.json already in memory
  │
  ▼  for each TripCandidate (up to 3 per single route, 1 per multi-route)
  │
  ├─ POST proxy /navitia/journey  { from_uic, to_uic, datetime_str }  (outbound)
  ├─ POST proxy /navitia/journey  { from_uic, to_uic, datetime_str }  (return)
  │
  ▼
journey_parser.js.parseBestJourney(apiResponse)
  │
  ▼
search.js.buildItineraryCard(candidate, outboundJourney, returnJourney)
  │
  ▼
results.js.renderResults(itineraries, container)
  │
  └─ click card → map.js.showItineraryOnMap(itinerary)
```

---

## Module Descriptions

### `static/js/map.js`

Leaflet + OpenStreetMap France tiles (French labels, greyscale CSS filter).
Manages two layer groups:

- **routeLayers** — always-visible colored thin polylines (weight 3), one per
  route, loaded from `static/data/routes/*.json` at page start. Each polyline
  shows a floating info panel on hover (photo, description, distance, status,
  connections, link) that stays open when the mouse moves onto it.
- **itineraryLayer** — cleared and redrawn on each card click:
  - biked segment in route color (weight 6)
  - blue circle marker at departure station
  - red circle marker at arrival station

Public API: `window.InterMap = { initMap, loadAllRoutes, setRouteVisible, showItineraryOnMap, clearMap, centerOn }`

### `static/js/planner.js`

Pure JS (no network). Port of `app/itinerary/rhythm.py` and
`app/itinerary/planner.py`.

Key functions:
- `haversineKm(lat1, lon1, lat2, lon2)`
- `totalBikingKm(nDays, rhythmKey)`
- `getStationsNearRouteStart(routeData, depLat, depLon, n)`
- `computeEndStation(routeData, startStation, bikingKm)`
- `extractSegmentPoints(trackPoints, startKm, endKm)`
- `findAllItineraries(routeIds, index, depLat, depLon, nDays, rhythmKey)`

Public API: `window.InterPlanner`

### `static/js/journey_parser.js`

Port of `app/navitia/journey_parser.py`. Parses raw Navitia API JSON into
structured `JourneyResult` objects.

Public API: `window.InterJourney`

### `static/js/results.js`

Renders itinerary cards (expandable). Each card carries a `data-route` attribute
on the route badge so CSS can apply the correct color.

Public API: `window.InterResults`

### `static/js/search.js`

Orchestrates the search flow:
1. Loads static data files
2. Handles station autocomplete (local filtering); selecting a city centres the map on it
3. Manages the French date input (DD/MM/YYYY display, ISO hidden field)
4. On submit: calls `InterPlanner`, then proxy, then `InterJourney`, assembles cards
5. Wires checkbox changes to `InterMap.setRouteVisible` (including Select All)
6. Reads/writes proxy URL from `localStorage`
7. Wires the "?" help button to open the help modal

Public API: `window.InterSearch`

---

## Proxy Server (`proxy/app.py`)

Single Flask route `POST /navitia/journey`. Accepts JSON body
`{ from_uic, to_uic, datetime_str }`, forwards a GET to
`https://api.navitia.io/v1/journeys` with HTTP Basic auth (token from
`NAVITIA_TOKEN` env var), returns the raw Navitia JSON.

CORS headers allow requests from any origin so GitHub Pages can call it.

---

## Python Backend (Local Development)

The original Flask app (`app/`) is fully preserved. Running `flask --app app run`
locally still works without any proxy — `NAVITIA_TOKEN` is read from the
environment directly. The `templates/index.html` (Jinja2) and `/api/search`
endpoint remain intact.

---

## Static Data Files

| File | Size | Generated by |
|---|---|---|
| `static/data/stations.json` | ~350 KB | `scripts/export_stations_json.py` |
| `static/data/route_stations.json` | ~540 KB | `scripts/preprocess.py` (with `track_points`) |
| `static/data/routes/ev3.json` … | ~20 KB each | `scripts/export_route_geometries.py` |

These files are committed to the repository and served directly by GitHub Pages.
Re-generate them only when source GPX or station data changes.
