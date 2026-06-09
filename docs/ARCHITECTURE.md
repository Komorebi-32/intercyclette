# Architecture

## Overview

Intercyclette is a fully static web application. Precomputed data files are
served as static JSON; train schedules are fetched live from the Transitous
public routing API. No proxy server and no API token are required.

The UI is a full-page Leaflet map with a floating left search panel. A welcome
modal greets the user on load; the top nav exposes help, roadmap, and credits
modals.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Static site (GitHub Pages / any static host)                       │
│                                                                     │
│  index.html       full-page map + floating search panel + modals    │
│                   (welcome / help / roadmap / credits)              │
│  static/css/style.css                                               │
│  static/js/                                                         │
│    map.js          Leaflet map, colored route overlays,             │
│                    housing + restaurant point layers                │
│    planner.js      JS port of Python itinerary planner              │
│    transitous.js   Transitous API client (live train schedules)     │
│    co2.js          Carbon footprint computation and avoided CO2     │
│    results.js      Render itinerary cards                           │
│    search.js       Form, autocomplete, modals, layer toggles,       │
│                    orchestrates search                              │
│    slideshow.js    Roadmap modal feature-preview carousel           │
│  static/data/                                                       │
│    stations.json                  All SNCF stations (autocomplete)  │
│    route_stations.json            Route–station proximity index     │
│    housing.json                   OSM accommodations ≤ 5 km         │
│    accueil_velo_housing.json      Accueil Vélo accommodations ≤ 5km │
│    accueil_velo_restaurants.json  Accueil Vélo restaurants ≤ 5 km   │
│    routes/                        One JSON per Eurovelo route        │
│      ev3.json, ev4.json, … (9 files, colored polylines)            │
└─────────────────────────────────────────────────────────────────────┘
```

At page load the browser fetches the precomputed data files (stations,
route_stations, the three accommodation/restaurant files) and the nine route
geometry files. At search time it issues live API calls to Transitous for each
candidate journey pair.

---

## Data Flow

### 1. Page Load

```
browser
  ├─ fetch static/data/stations.json        → populate autocomplete
  ├─ fetch static/data/route_stations.json  → load route index into memory
  └─ fetch static/data/routes/ev*.json (×9) → draw colored polylines on map
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
  ├─ transitous.js.queryJourney(fromLat, fromLon, toLat, toLon, "YYYY-MM-DDTHH:MM:SS")
  │    outbound: 08:00 on the outbound date
  ├─ transitous.js.queryJourney(fromLat, fromLon, toLat, toLon, "YYYY-MM-DDTHH:MM:SS")
  │    return:   16:00 on the return date
  │  both async — issue GET to https://api.transitous.org/api/v5/plan
  │
  ▼
transitous.js.buildJourneyResult(itinerary)
  │  strips WALK legs; reads station names from first/last transit leg;
  │  converts UTC timestamps to browser-local ISO strings;
  │  classifies train type (HIGHSPEED_RAIL→TGV, LONG_DISTANCE_RAIL→INTERCITES,
  │  REGIONAL_RAIL→TER) and computes segment distance from legGeometry polyline
  │
  ▼
search.js.buildItineraryCard(candidate, outboundJourney, returnJourney)
  │
  ▼
results.js.renderResults(itineraries, container)
  │  buildDetailHtml() calls co2.js.buildCarbonInfoHtml(outbound, return_train)
  │    → computeJourneyCo2: Σ (emission_factor[train_type] × distance_km)
  │    → computeAvoidedCo2: 388 kg CO2e (Madrid flight A/R) − total train CO2
  │
  └─ click card → map.js.showItineraryOnMap(itinerary)
```

---

## Module Descriptions

### `static/js/map.js`

Leaflet + OpenStreetMap France tiles (French labels, greyscale CSS filter).
Requires both **Leaflet 1.9.4** and **leaflet.markercluster 1.5.3** (the
accommodation layers are clustered). The map uses a **Canvas renderer**
(`preferCanvas: true`) so the full-resolution route overlays stay smooth.
Manages several layer groups:

- **routeLayers** — colored thin polylines (weight 3), one per route, loaded
  from `static/data/routes/*.json` at page start. These now carry **every GPX
  vertex** (tens of thousands of points each; coordinates rounded to
  `GEOMETRY_COORD_DECIMALS` = 5 dp ≈ 1 m) so the drawn line precisely follows
  the real route; a `smoothFactor` of `ROUTE_SMOOTH_FACTOR` lets Leaflet drop
  sub-pixel detail when zoomed out. Each polyline shows a floating info panel on
  hover (description, distance, connections, link) that stays open when the
  mouse moves onto it. When an itinerary card is selected, these overlays are
  temporarily hidden (`setRoutesHidden`).
- **itineraryLayer** — cleared and redrawn on each card click:
  - train legs as dashed polylines, each in a distinct per-leg color chosen by
    `getTrainLegColors(routeId)` (green/orange/blue/violet/red palette, filtered
    to stay visually distinct from the selected route color via an RGB-distance
    threshold)
  - biked segment in route color (weight 6); full-resolution, spanning the
    departure→arrival stations (sliced from the route track_points between the
    vertices nearest each station, so it sits exactly on the route line)
  - direction arrows (`addDirectionArrows`) placed at even arc-length intervals
    along every train leg and the bike leg, rotated to the local travel bearing
  - blue circle marker at departure station
  - red circle marker at arrival station

  `focusOnLeg(itinerary, legType)` fits the map to a single leg ("outbound" /
  "bike" / "return") without redrawing — called when the user clicks a
  detail-section in a results card.
- **housingLayer** — an `L.markerClusterGroup` of OSM accommodations from
  `housing.json`, rendered as pale-blue dots (`housing-dot housing-dot--osm`).
  Each marker shows a hover panel built by `buildHousingPanelHtml(point)`.
  Layer is rebuilt by `applyHousingFilter()` whenever category or AV-only state
  changes — it is not pre-populated at load time.
- **accueilVeloHousingLayer** — Accueil Vélo accommodations from
  `accueil_velo_housing.json`, hover panel via
  `buildAccueilVeloHousingPanelHtml(point)`. Same lazy-filter approach as above.
  Both housing layers share the **same blue dot style** (`housing-dot--osm` and
  `housing-dot--av` map to one rule) so OSM and Accueil Vélo points are visually
  unified.
- **accueilVeloRestaurantsLayer** — Accueil Vélo restaurants from
  `accueil_velo_restaurants.json`; toggled by `toggleAccueilVeloRestaurants`.

**Housing category filter.** Each housing point is classified by name into
`'camping'`, `'hotel'`, or `'gite'` (default) via `classifyHousingType(name)`.
`setHousingCategories(categories)` sets the active category set and calls
`applyHousingFilter()` to rebuild both layers. `setAccueilVeloFilter(avOnly)`
restricts the visible layer to only Accueil Vélo points when `avOnly` is true.

**OSM/Accueil Vélo deduplication.** When both sources are shown, OSM points that
duplicate an Accueil Vélo point (same physical establishment) are dropped so the
establishment is kept only as its Accueil Vélo point. Detection is grid-based:
`buildAvCoordKeySet` buckets AV coordinates into ~11 m cells
(`DUP_COORD_DECIMALS = 4`, cached in `avCoordKeySet`, invalidated when AV data
loads) and `isOsmDuplicateOfAv` matches an OSM point against the 3×3
neighbourhood of cells (~33 m radius). Tested in `tests/test_housing_dedup.js`.

The raw OSM and Accueil Vélo housing arrays are **retained** after load
(`housingPointsRaw` / `accueilVeloHousingRaw`) and exposed via
`getHousingPools()` so the housing-proposal feature can search them client-side.
`buildHousingInfoHtml(point, source)` plus the `showHoverPanel` /
`positionHoverPanel` / `scheduleCloseHoverPanel` aliases let the results card
reuse the exact map hover box; `focusHousing(lat, lon)` pans to a housing point.
When an opened itinerary carries a `housing` array, `showItineraryOnMap` drops a
🛏️ marker per night (`renderNightHousingMarkers`).

Public API: `window.InterMap = { initMap, loadAllRoutes, setRouteVisible,
setRoutesHidden, clearMap, showItineraryOnMap, focusOnLeg, getTrainLegColors,
centerOn, loadHousingPoints, loadAccueilVeloHousing, loadAccueilVeloRestaurants,
toggleAccueilVeloRestaurants, setHousingCategories, setAccueilVeloFilter,
classifyHousingType, buildEmojiStationIcon, addMarker, setDepartureMarker,
getHousingPools, buildHousingInfoHtml, focusHousing, showHoverPanel,
positionHoverPanel, scheduleCloseHoverPanel }`

### `static/js/planner.js`

Pure JS (no network). Port of `app/itinerary/rhythm.py` and
`app/itinerary/planner.py`.

Key functions:
- `haversineKm(lat1, lon1, lat2, lon2)`
- `totalBikingKm(nDays, rhythmKey)`
- `getStationsNearRouteStart(routeData, depLat, depLon, n)`
- `computeEndStation(routeData, startStation, bikingKm)`
- `nearestPointIndex(polyline, lat, lon)` — argmin haversine vertex lookup
- `extractSegmentPoints(trackPoints, startStation, endStation)` — slices the
  full-resolution route `track_points` between the vertices nearest the two
  stations (so the bike line spans station→station and traces the GPX exactly)
- `interpolatePointAtKm(polyline, cumulative, targetKm)` — `[lat,lon]` at a
  distance along the route (with `cumulativeDistancesKm`)
- `nearestHousing(lat, lon, pools)` — nearest Accueil Vélo within
  `HOUSING_RADIUS_KM`, else nearest OSM accommodation
- `computeNightlyHousing(routeData, startStation, nDays, rhythmKey, pools)` —
  one overnight stop per night (`nDays-1` nights; night *k* at
  `start + (k-0.5)·dailyKm`); drives the optional housing-proposal feature
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

`buildJourneyResult(itinerary)` strips walking legs, reads station names from
the first and last transit legs of the API response (ensuring the displayed
departure/arrival station matches the actual boarding/alighting point, which
may differ from the user's selected city), converts UTC timestamps to
browser-local ISO strings (for correct French time display), and returns the
shape expected by `buildItineraryCard()` in `search.js`.

Each section in the returned `sections` array includes:
- `train_type` — classified from `leg.mode`: `"TGV"` (HIGHSPEED_RAIL), `"INTERCITES"` (LONG_DISTANCE_RAIL), `"TER"` (REGIONAL_RAIL or unknown)
- `distance_km` — decoded from `leg.legGeometry.points` (Google Polyline, precision 6) via haversine sum; `null` if geometry is absent

The browser sends a `Referer` header automatically on every cross-origin
request, satisfying the Transitous attribution requirement.

Public API: `window.InterTimetable = { queryJourney, buildJourneyResult, formatDurationMinutes, minutesToTime }`

### `static/js/co2.js`

Pure JS (no network). Computes the carbon footprint of train journeys and
the avoided CO2 vs. a reference Madrid round-trip flight.

Emission factors (ADEME Base Empreinte 2023, kg CO2e per passenger-km):

| Train type | Factor |
|---|---|
| TGV | 0.00173 kg CO2e/km |
| Intercités | 0.00514 kg CO2e/km |
| TER | 0.02440 kg CO2e/km |

Reference: Paris–Madrid round-trip flight = 388 kg CO2e (194 kg × 2).

Key functions:
- `computeSectionCo2(section)` — `emission_factor[train_type] × distance_km`; returns `null` if distance unknown
- `computeJourneyCo2(journey)` — sums section CO2 values
- `computeAvoidedCo2(outboundCo2Kg, returnCo2Kg)` — `388 − (outbound + return)`
- `buildCarbonInfoHtml(outboundJourney, returnJourney)` — returns the "Info Carbone 🌎" hover-tooltip pill: only the label is visible; hovering reveals the full carbon breakdown text

Public API: `window.InterCo2`

### `static/js/results.js`

Renders itinerary cards (expandable). Collapsed cards show only the
`card-header` (route badge + name + expand icon); the journey summary is
revealed on expansion. Each card carries a `data-route` attribute on the route
badge so CSS can apply the correct color. The expanded detail uses three
`detail-section` blocks (train aller, bike, train retour), each with a colored
left-border line and a mode pill (wrapped in a `leg-pill-row`) at the top. The
pill is pulled up with a negative margin so it bridges the junction between the
previous leg's colored line and this leg's line. Each train leg gets its own
color from `InterMap.getTrainLegColors(routeId)` (applied to the pill background
and section border); the bike section uses the route color (via `data-route`).
For train legs the departure date is shown to the right of the pill; the bike
leg shows dates at departure and again at arrival when they fall on different
days.

Each train/bike section carries a `data-leg` attribute ("outbound" / "bike" /
"return"); `attachLegFocusHandlers` makes clicking a section call
`InterMap.focusOnLeg` to zoom the map to that leg (instead of collapsing the
card) via `stopPropagation`. Clicking the booking button does nothing to the
card — both the card toggle and the section handler ignore clicks inside
`.btn-book`.

Key helper functions:
- `buildTrainLegHtml(journey, label, color)` — renders one train leg with a pill
  row (colored pill + departure date), stop rows (time + station), duration
  connector, and booking button.
- `buildBikeLegHtml(itinerary, rhythmLabel, bikeDepartureDate, bikeArrivalDate,
  bikeStartIso)` — renders the bike leg with colored pill, station km markers,
  and conditional dates. When `itinerary.housing` is non-empty it also renders a
  `benefit-pill` "Voir les hébergements" that toggles a per-night list
  (`buildHousingListHtml`): each night shows the distance ridden and a
  hoverable/clickable housing name.
- `attachHousingHandlers(card, itinerary)` — toggles the night list and wires
  each housing name to the shared map hover box (`InterMap.buildHousingInfoHtml`
  + hover-panel aliases) and to `InterMap.focusHousing` on click.
- `buildDetailHtml(itinerary)` — composes the full expanded card detail from the
  above helpers and `InterCo2.buildCarbonInfoHtml()`.

The optional housing-proposal feature (checkbox `#propose-housing`, active for
`n_days ≥ 2`) is computed in `search.js` via
`InterPlanner.computeNightlyHousing(...)` using `InterMap.getHousingPools()`, and
attached as `itinerary.housing`.

Public API: `window.InterResults`

### `static/js/search.js`

Orchestrates the search flow:
1. Loads static data files (stations, route index) and triggers the map's point
   layers (`loadHousingPoints`, `loadAccueilVeloHousing`, `loadAccueilVeloRestaurants`)
2. Handles station autocomplete (local filtering); selecting a city centres the
   map and sets a departure marker via `InterMap.setDepartureMarker`
3. Initialises the native date picker (`#travel-date`, `initTravelDateInput`):
   sets `min` to today, defaults to tomorrow; value is read directly as ISO
   YYYY-MM-DD (browser renders it in the user's locale format)
4. On submit: calls `InterPlanner`, then awaits `InterTimetable.queryJourney` for each candidate
5. Wires route checkbox changes to `InterMap.setRouteVisible` (including Select All).
   The landscape **criteria pills** (`.route-criteria-pill[data-criteria]`,
   river/sea/mountain) — `ROUTE_CRITERIA` + `applyCriteriaSelection` /
   `initRouteCriteriaPills` — drive the checkbox selection and map overlays to the
   union of the active criteria's routes (none active = all routes); the
   checkbox list is collapsed under a `<details>` "Sélectionner des routes
   Eurovelo". `mountain` is a not-yet-available placeholder (inert, hover tooltip)
6. Wires the **center-top map layer pills** via `initMapLayerPills`:
   - `initHousingPills` wires the single "Hébergements" pill (toggles the
     left-aligned dropdown, hidden by default; the pill carries an arrow that
     rotates via `aria-expanded` when expanded/collapsed), three category
     checkboxes (Campings / Gîtes / Hôtels), and the
     "Accueil Vélo uniquement" sub-pill; category changes call
     `InterMap.setHousingCategories()`; the AV pill calls
     `InterMap.setAccueilVeloFilter()`
   - `initRestaurantPill` wires the Restaurants pill to
     `InterMap.toggleAccueilVeloRestaurants`; pills gain `is-active` when enabled
7. Wires the modals: the **welcome** modal (shown on load), the **help** modal
   (`btn-help`), and via the generic `initOverlayModal(btnId, modalId, closeId)`
   the **roadmap** (`btn-roadmap`) and **credits** (`btn-credits`) modals — each
   closeable by ✕, backdrop click, or Escape

Public API: `window.InterSearch`

---

### `static/js/slideshow.js`

Drives the feature-preview carousel at the top of the **roadmap** modal
("Développements futurs"): one slide at a time, navigated by prev/next arrows,
dots, or the arrow keys. `nextIndex(current, total, direction)` is the pure
wrap-around index helper (unit-tested in `tests/test_slideshow.js`);
`initSlideshow` wires the DOM and self-initialises on `DOMContentLoaded`. Slides
toggle an `is-active` class — nothing is measured or moved — so it behaves
correctly whether the modal is open or still hidden. The three preview images
live in `previews/preview_*.png` (generated from the mockups in `previews/`).

Public API: `window.InterSlideshow`

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
| `static/data/route_stations.json` | ~14 MB (~1.5 MB gzip) | `scripts/preprocess.py` |
| `static/data/routes/ev*.json` (×9) | ~0.6 MB each, ~5 MB total (~1.2 MB gzip) | `scripts/export_route_geometries.py` |
| `static/data/housing.json` | ~3.2 MB | `scripts/export_housing_json.py` |
| `static/data/accueil_velo_housing.json` | ~420 KB | `scripts/export_accueil_velo_json.py` |
| `static/data/accueil_velo_restaurants.json` | ~86 KB | `scripts/export_accueil_velo_json.py` |

No timetable data file is needed at runtime — train schedules are fetched live
from the Transitous API.

---

## Preprocessing & Data Generation (offline)

All `static/data/*.json` files are generated offline by the Python tooling and
committed to the repo; the deployed app never runs Python. The geo matchers live
in `app/geo/` and are invoked by the `scripts/*.py` exporters:

| Module | Role |
|---|---|
| `app/geo/distance.py` | Pure geometry — haversine, point-to-polyline distance, interpolation |
| `app/geo/gpx_parser.py` | Parse the 9 Eurovelo GPX tracks into `GpxTrack` |
| `app/geo/station_matcher.py` | Match SNCF stations ≤ 5 km from each route → `route_stations.json` |
| `app/geo/housing_matcher.py` | Match OSM accommodations ≤ 5 km from routes (dedup by `osm_id`) |
| `app/geo/accueil_velo_matcher.py` | Match Accueil Vélo CSV entries ≤ 5 km, split into Hébergement / Restauration |

**Python / JavaScript split.** The Python in `app/` and `scripts/` is used only
for local development (Flask) and offline data generation. The deployed app is
the static frontend in `static/js/`. The rhythm/distance logic and constants
(RHYTHMS, ROUTE_COLORS, zone fractions) are **mirrored** in both
`app/itinerary/` (Python) and `static/js/planner.js` (JS) — a change to one
normally requires the matching change in the other.

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
          "duration": 3840,
          "distance": 0,
          "routeLongName": "Paris - Orléans",
          "legGeometry": { "points": "<encoded polyline>", "precision": 6, "length": 42 }
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
- `leg.distance` is always `0` for transit legs; actual rail distance is decoded
  from `leg.legGeometry.points` (Google Polyline Encoding, precision 6).
- Observed `leg.mode` values: `WALK`, `REGIONAL_RAIL`, `HIGHSPEED_RAIL`, `SUBWAY`.
