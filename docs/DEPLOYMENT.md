# Deployment Guide

## Overview

Intercyclette is a fully static application — no proxy server, no API token,
no backend required at runtime.

- **Static site** → GitHub Pages (or any static host)
- **No proxy** — train schedules are served from `static/data/timetable.json`

---

## 1. Generate and commit static data files

All data files must be generated locally and committed before deploying.

```bash
# Route–station proximity index
python3 scripts/preprocess.py

# GTFS timetable index (TER + Intercités only)
python3 scripts/build_gtfs_index.py

# Station autocomplete list
python3 scripts/export_stations_json.py

# Colored route polylines
python3 scripts/export_route_geometries.py

# Copy proximity index to static/
cp data/processed/route_stations.json static/data/route_stations.json

# Commit
git add static/data/
git commit -m "update static data files"
git push
```

> **Note on file size:** `static/data/timetable.json` can be 5–15 MB.
> GitHub Pages has a 100 MB per-file limit, so this is fine. However, if you
> prefer not to commit large generated files, host the JSON on a CDN and
> update the fetch URL in `timetable.js`.

---

## 2. Deploy to GitHub Pages

### Enable GitHub Pages

1. Go to your repository on GitHub → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `(root)`
4. Save

The site will be available at `https://<username>.github.io/<repo>/`.

### Custom domain (optional)

Add a `CNAME` file at the repository root with your domain, then configure DNS
as instructed by GitHub.

---

## 3. Verify the deployment

Open the deployed URL and:

1. Start typing a city name — autocomplete suggestions should appear
2. Select a departure city, choose dates and routes, click **Rechercher**
3. Itinerary cards should appear without any proxy configuration prompt
4. Open browser DevTools → Network — confirm no external API calls are made
   (only fetches to `static/data/*.json` files)

---

## Re-deploying after GTFS data updates

When a new GTFS export is available from SNCF Open Data:

```bash
# Replace data/raw/Export_OpenData_SNCF_GTFS_NewTripId/ with the new export

python3 scripts/build_gtfs_index.py
git add static/data/timetable.json
git commit -m "refresh timetable from GTFS YYYYMMDD"
git push
```

GitHub Pages redeploys automatically on push.

When Eurovelo GPX files or SNCF station data change:

```bash
python3 scripts/preprocess.py
python3 scripts/export_stations_json.py
python3 scripts/export_route_geometries.py
cp data/processed/route_stations.json static/data/route_stations.json
git add static/data/ data/processed/
git commit -m "refresh route and station data"
git push
```
