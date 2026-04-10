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

### `static/js/timetable.js`

In-browser GTFS lookup engine. Loads `static/data/timetable.json` once (on
first search), builds three acceleration structures:

- `_serviceSets` — `{svc_key → Set<dateInt>}` for O(1) date membership tests
- `_uicToTripIndices` — `Map<uic_int → number[]>` reverse index so only
  relevant trips are scanned per query; also populated for alias UICs
- `_uicAliasMap` — `Map<geojson_uic → gtfs_uic>` resolves the UIC mismatch
  between `gares-de-voyageurs.geojson` (autocomplete source) and GTFS

`queryJourney(fromUic, toUic, dateInt, afterMinutes, maxResults)` resolves
both UICs through `_uicAliasMap` before querying, so autocomplete results
always match correctly even for stations with mismatched UIC codes. Returns
direct-train rows (dep/arr minutes, duration, train type) sorted by departure.

Only TER and Intercités trains are included (filtered at build time by
`scripts/build_gtfs_index.py`).

Public API: `window.InterTimetable = { loadTimetable, queryJourney, buildJourneyResult, formatDurationMinutes, getTimetableDateRange, minutesToTime, minutesToIsoDatetime }`

### `static/js/results.js`

Renders itinerary cards (expandable). Each card carries a `data-route` attribute
on the route badge so CSS can apply the correct color.

Public API: `window.InterResults`

### `static/js/search.js`

Orchestrates the search flow:
1. Loads static data files (stations, route index, timetable on demand)
2. Handles station autocomplete (local filtering); selecting a city centres the map
3. Manages the French date input (DD/MM/YYYY display, ISO hidden field)
4. On submit: calls `InterPlanner`, then `InterTimetable`, assembles cards
5. Validates requested date against timetable date range
6. Wires checkbox changes to `InterMap.setRouteVisible` (including Select All)
7. Wires the "?" help button to open the help modal

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
| `static/data/timetable.json` | 5–15 MB | `scripts/build_gtfs_index.py` |
| `static/data/routes/ev*.json` (×9) | ~20 KB each | `scripts/export_route_geometries.py` |

`timetable.json` is large enough that it should not be committed to the
repository if hosting on GitHub Pages with a 100 MB file limit — serve it
from a CDN or regenerate locally as needed.

---

## Timetable Index Format

`static/data/timetable.json`:

```json
{
  "generated_at": "2026-04-10T12:00:00",
  "train_types": ["TER", "INTERCITES"],
  "date_range": { "min": 20260101, "max": 20261231 },
  "uic_aliases": { "87547026": "87547000", "87271023": "87271007" },
  "services": {
    "1": [20260501, 20260502, ...],
    "2": [20260601, ...]
  },
  "trips": [
    { "svc": 1, "type": 0, "stops": [[87723197, 480], [87001000, 570]] }
  ]
}
```

- `svc`: integer key into `services`
- `type`: 0 = TER, 1 = Intercités
- `stops`: `[uic_int, dep_minutes_since_midnight]`, ordered by stop_sequence
- `uic_aliases`: maps geojson UIC codes to their GTFS equivalents for stations
  where `gares-de-voyageurs.geojson` and the GTFS feed use different codes
  (matched by normalised station name at build time)
- Dates as YYYYMMDD integers, times as minutes — minimises JSON size
