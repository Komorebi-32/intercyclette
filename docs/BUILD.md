# Build Guide

## Prerequisites

- Python 3.10+
- pip3
- GTFS data from SNCF Open Data (see step 2)

## 1. Install Python dependencies

```bash
pip3 install -r requirements.txt
```

## 2. Download GTFS data

Download the SNCF GTFS export from [data.sncf.com](https://data.sncf.com) and
extract the contents into:

```
data/raw/Export_OpenData_SNCF_GTFS_NewTripId/
```

The directory must contain at minimum: `stops.txt`, `trips.txt`,
`stop_times.txt`, `calendar_dates.txt`.

## 3. Generate the route–station proximity index

Run once (or again when GPX or station data changes):

```bash
python3 scripts/preprocess.py
```

Reads the 9 Eurovelo GPX files and ~2,800 SNCF stations, finds all stations
within 5 km of each route, writes:

```
data/processed/route_stations.json   (~540 KB, includes downsampled track_points)
```

Options:

```bash
python3 scripts/preprocess.py --max-distance 3.0   # tighter proximity threshold
python3 scripts/preprocess.py --help               # all options
```

## 4. Compile the GTFS timetable index

```bash
python3 scripts/build_gtfs_index.py
```

Streams `stop_times.txt` (72 MB), filters to **TER** and **Intercités** trains
in France only (stop IDs with UIC prefix `87`), and writes:

```
static/data/timetable.json   (5–15 MB depending on date range)
```

Progress and stats are printed to stdout:

```
Building GTFS timetable index…
  [1/5] Loading filtered stops…
        4 231 qualifying stop IDs
  [2/5] Loading trip → service map…
        53 663 trips
  [3/5] Streaming stop_times.txt…
        18 441 qualifying trips
  [4/5] Loading service dates (3 102 service IDs)…
        3 097 services with dates
  [5/5] Assembling compact index…
  Timetable written to static/data/timetable.json
  Trips: 18 387  |  Services: 3 097  |  Date range: 20260101–20261231  |  Size: 8 421 KB
Done.
```

## 5. Export remaining static data files

```bash
# All SNCF stations for autocomplete (~350 KB)
python3 scripts/export_stations_json.py

# 9 colored route polylines (~20 KB each)
python3 scripts/export_route_geometries.py

# Copy proximity index to static/
cp data/processed/route_stations.json static/data/route_stations.json
```

Output files:

```
static/data/stations.json
static/data/route_stations.json
static/data/routes/ev3.json
static/data/routes/ev4.json
static/data/routes/ev5.json
static/data/routes/ev6.json
static/data/routes/ev8.json
static/data/routes/ev15.json
static/data/routes/ev19.json
static/data/routes/vel.json
static/data/routes/via.json
```

## 6. Run the test suite

```bash
python3 -m pytest tests/ -v
```

All tests are isolated (no network, no real GTFS files — synthetic fixtures
in `tests/fixtures/gtfs/` are used for GTFS tests).

## 7. Serve locally

```bash
python3 -m http.server 8080
# visit http://localhost:8080
```

No proxy or token needed. The search reads `static/data/timetable.json`
directly. Click the **?** button for usage instructions.

## 8. Serve locally (Flask backend, alternative)

The Flask app is preserved for local development convenience:

```bash
flask --app app run
# visit http://localhost:5000
```

Uses the Jinja2 template (`templates/index.html`) and serves `/api/stations`.
Journey search is still handled by the browser via `timetable.js`.
