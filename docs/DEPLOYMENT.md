# Deployment Guide

## Overview

- **Static site** → GitHub Pages (free, no server required)
- **Proxy server** → Render.com or Railway (free tier, keeps NAVITIA_TOKEN secure)

---

## 1. Deploy the proxy server

### Option A: Render.com (recommended)

1. Create a free account at https://render.com
2. New → **Web Service** → connect your GitHub repository
3. Settings:
   - **Root directory**: `proxy`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `gunicorn app:app`
   - **Environment**: Python 3
4. Add environment variable:
   - Key: `NAVITIA_TOKEN`
   - Value: your token from https://www.navitia.io
5. Deploy. Note the URL: `https://intercyclette-proxy.onrender.com` (varies)

### Option B: Railway

1. Create a free account at https://railway.app
2. New Project → **Deploy from GitHub repo** → select this repo
3. Set **Root directory** to `proxy`
4. Add environment variable `NAVITIA_TOKEN` = your token
5. Railway auto-detects the Python app and deploys it.
6. Note the generated URL.

### Verify the proxy

```bash
curl -X POST https://your-proxy-url/navitia/journey \
  -H "Content-Type: application/json" \
  -d '{"from_uic":"87391003","to_uic":"87113001","datetime_str":"20260501T080000"}'
```

Expect a Navitia API JSON response (journeys array).

---

## 2. Deploy the static site to GitHub Pages

### Prerequisites

All static data files must be generated and committed:

```bash
python3 scripts/preprocess.py
python3 scripts/export_stations_json.py
python3 scripts/export_route_geometries.py
git add static/data/
git commit -m "update static data files"
git push
```

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

## 3. Configure the proxy URL in the browser

On first visit to the deployed site:

1. Click the **gear icon** (⚙) in the top bar to open the settings panel
2. Enter the proxy URL: `https://your-proxy-url.onrender.com`
3. Click **Enregistrer** — the URL is stored in `localStorage` and persists
   across visits in the same browser

---

## Obtaining a Navitia token

1. Register at https://www.navitia.io
2. After login, your token appears in the dashboard
3. The free tier provides sufficient quota for personal use (a few hundred
   journey lookups per day)

---

## Re-deploying after data updates

If the Eurovelo GPX files or SNCF station data change:

```bash
python3 scripts/preprocess.py
python3 scripts/export_stations_json.py
python3 scripts/export_route_geometries.py
git add static/data/ data/processed/
git commit -m "refresh static data"
git push
```

GitHub Pages redeploys automatically on push.
