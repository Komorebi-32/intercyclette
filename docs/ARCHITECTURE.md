# Architecture

## Overview

Intercyclette is a fully self-contained static web application. All data is
precomputed at build time and served as static JSON files. No proxy server,
no API token, and no external network calls are made at query time.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Static site (GitHub Pages / any static host)                       │
│                                                                     │
│  index.html                    ─── single HTML page, no server     │
│  static/css/style.css                                               │
│  static/js/                                                         │
│    map.js          Leaflet map, colored route overlays              │
│    planner.js      JS port of Python itinerary planner              │
│    timetable.js    In-browser GTFS journey lookup engine            │
│    results.js      Render itinerary cards                           │
│    search.js       Form, autocomplete, orchestrates search          │
│  static/data/                                                       │
│    stations.json           All SNCF stations (autocomplete)         │
│    route_stations.json     Route–station proximity index            │
│    timetable.json          Compiled GTFS timetable index            │
│    routes/                 One JSON per Eurovelo route              │
│      ev3.json, ev4.json, … (9 files, colored polylines)            │
└─────────────────────────────────────────────────────────────────────┘
```

At query time the browser fetches only the three precomputed data files
(stations, route_stations, timetable) — all computation runs in-memory.

---

## Data Flow

### 1. Page Load

```
browser
  ├─ fetch static/data/stations.json       → populate autocomplete
  ├─ fetch static/data/route_stations.json → load route index into memory
  ├─ fetch static/data/routes/ev*.json (×9) → draw colored polylines on map
  └─ (deferred) fetch static/data/timetable.json → loaded on first search
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
  ├─ timetable.js.queryJourney(fromUic, toUic, dateInt, 480)   (outbound 08:00)
  ├─ timetable.js.queryJourney(returnUic, fromUic, dateInt, 960) (return 16:00)
  │  both synchronous — no network, operates on in-memory timetable index
  │
  ▼
timetable.js.buildJourneyResult(row, fromNom, toNom, dateInt)
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

### `static/js/transitous.js`

In-browser Transitous API client. Issues live `GET` requests to
`https://api.transitous.org/api/v5/plan` for each pair of outbound and return
journeys. No precomputed data file is required.

`queryJourney(fromLat, fromLon, toLat, toLon, localIsoDatetime, maxResults)`
builds a URL with `transitModes=RAIL&maxTransfers=5`, converts the local
datetime to UTC via `new Date(localIsoDatetime).toISOString()`, and fetches
the API. Returns raw Transitous itinerary objects.

`buildJourneyResult(itinerary, fromNom, toNom)` strips walking legs, converts
UTC timestamps to browser-local ISO strings (for correct French time display),
and returns the shape expected by `buildItineraryCard()` in `search.js`.

The browser sends a `Referer` header automatically on every cross-origin
request, satisfying the Transitous attribution requirement.

Public API: `window.InterTimetable = { queryJourney, buildJourneyResult, formatDurationMinutes, minutesToTime }`

### `static/js/results.js`

Renders itinerary cards (expandable). Each card carries a `data-route` attribute
on the route badge so CSS can apply the correct color.

Public API: `window.InterResults`

### `static/js/search.js`

Orchestrates the search flow:
1. Loads static data files (stations, route index)
2. Handles station autocomplete (local filtering); selecting a city centres the map
3. Manages the French date input (DD/MM/YYYY display, ISO hidden field)
4. On submit: calls `InterPlanner`, then awaits `InterTimetable.queryJourney` for each candidate
5. Wires checkbox changes to `InterMap.setRouteVisible` (including Select All)
6. Wires the "?" help button to open the help modal

Public API: `window.InterSearch`

---

## Python Backend (Local Development Only)

The original Flask app (`app/`) is preserved for local development.
Running `flask --app app run` serves the Jinja2 template at `/` and the
station list at `/api/stations`. The `/api/search` endpoint has been removed —
journey search is handled entirely in the browser.

---

## Static Data Files

| File | Approximate size | Generated by |
|---|---|---|
| `static/data/stations.json` | ~350 KB | `scripts/export_stations_json.py` |
| `static/data/route_stations.json` | ~540 KB | `scripts/preprocess.py` |
| `static/data/routes/ev*.json` (×9) | ~20 KB each | `scripts/export_route_geometries.py` |

No timetable data file is needed at runtime — train schedules are fetched live
from the Transitous API.

---

## Transitous API Response Format

`GET https://api.transitous.org/api/v5/plan` returns:

```json
{
  "itineraries": [
    {
      "startTime": "2026-05-02T06:22:00Z",
      "endTime":   "2026-05-02T07:26:00Z",
      "duration":  3840,
      "transfers": 0,
      "legs": [
        {
          "mode": "WALK",
          "from": { "name": "START", "departure": "2026-05-02T06:21:00Z" },
          "to":   { "name": "Paris Austerlitz", "arrival": "2026-05-02T06:22:00Z" },
          "duration": 60
        },
        {
          "mode": "REGIONAL_RAIL",
          "from": { "name": "Paris Austerlitz", "departure": "2026-05-02T06:22:00Z" },
          "to":   { "name": "Orléans", "arrival": "2026-05-02T07:26:00Z" },
          "duration": 3840
        }
      ]
    }
  ]
}
```

- All times are UTC ISO 8601 strings; `transitous.js` converts them to local
  browser timezone before storing in the journey result.
- Walking legs (`mode: "WALK"`) are stripped by `buildJourneyResult()`.
- `transitModes=RAIL` is sent in the request to restrict results to rail services.
