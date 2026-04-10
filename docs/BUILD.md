# Build Guide

## Prerequisites

- Python 3.10+
- pip3

## 1. Install Python dependencies

```bash
pip3 install -r requirements.txt
```

## 2. Generate the route–station proximity index

Run once (or again if GPX/station data changes):

```bash
python3 scripts/preprocess.py
```

This reads the 9 Eurovelo GPX files and the ~2,800 SNCF stations, finds all
stations within 5 km of each route, and writes:

```
data/processed/route_stations.json   (~360 KB, includes downsampled track_points)
```

Options:

```bash
python3 scripts/preprocess.py --max-distance 3.0   # tighter proximity threshold
python3 scripts/preprocess.py --help               # all options
```

## 3. Export static data files

These three scripts produce the files served by GitHub Pages:

```bash
# All SNCF stations for autocomplete (~350 KB)
python3 scripts/export_stations_json.py

# 9 colored route polylines (~20 KB each)
python3 scripts/export_route_geometries.py
```

Output:

```
static/data/stations.json
static/data/route_stations.json   (copy of data/processed/route_stations.json)
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

All tests are isolated (no network, no real files).

## 5. Serve locally (static site)

No build step needed — open `index.html` directly via a local HTTP server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

The proxy URL must be set in the settings panel (⚙ top-right) before searching.
Click the **?** button next to the placeholder text for usage instructions.
For local testing, start the proxy in a separate terminal:

```bash
cd proxy
NAVITIA_TOKEN=your_token python3 app.py
# proxy listens on http://localhost:5001
```

Enter `http://localhost:5001` in the settings panel.

## 6. Serve locally (Flask backend, alternative)

The original Flask app still works for fully local development without a proxy:

```bash
export NAVITIA_TOKEN=your_token
flask --app app run
# visit http://localhost:5000
```

This uses the Jinja2 template (`templates/index.html`) and the Python planner
directly — no `static/data/` files needed.
