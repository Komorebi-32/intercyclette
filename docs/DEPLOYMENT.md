# Deployment Guide

## Overview

Intercyclette is a fully static application — no proxy server, no API token,
no backend required at runtime.

- **Static site** → GitHub Pages (or any static host)
- **Live train schedules** — fetched at search time from the
  [Transitous API](https://transitous.org/api/); no timetable file to maintain

---

## 1. Generate and commit static data files

The precomputed data files (station list, route–station index, route
geometries) must be generated locally and committed before deploying. Train
schedules are fetched live from Transitous at search time — no timetable file
is required.

```bash
# Route–station proximity index
python3 scripts/preprocess.py

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
3. Itinerary cards should appear with departure/arrival times
4. Open browser DevTools → Network — confirm requests go to
   `api.transitous.org/api/v5/plan` (one per outbound + one per return journey
   per candidate) and to `static/data/*.json` for precomputed data

---

## Re-deploying after data updates

Train schedules are always live from Transitous — no rebuild step required
when SNCF timetables change.

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
