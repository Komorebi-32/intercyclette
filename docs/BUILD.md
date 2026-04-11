# Build Guide

## Prerequisites

- Python 3.10+
- pip3

## 1. Install Python dependencies

```bash
pip3 install -r requirements.txt
```

## 2. Generate the route–station proximity index

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

## 3. Export static data files

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

## 4. Run the test suite

```bash
python3 -m pytest tests/ -v
```

All tests are isolated (no network, no external data files required).

## 5. Serve locally

```bash
python3 -m http.server 8080
# visit http://localhost:8080
```

No proxy or token needed. The search queries the Transitous API directly from
the browser. Click the **?** button for usage instructions.

## 6. Serve locally (Flask backend, alternative)

The Flask app is preserved for local development convenience:

```bash
flask --app app run
# visit http://localhost:5000
```

Uses the Jinja2 template (`templates/index.html`) and serves `/api/stations`.
Journey search is still handled by the browser via `transitous.js`.
