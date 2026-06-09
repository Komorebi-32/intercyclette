# Feature previews (showcase mockups)

Static, **non-production** mockups that preview three future features as if they
were already in the app. They are screenshot fodder — built to look exactly like
Intercyclette because they reuse the app's real stylesheet
([`../static/css/style.css`](../static/css/style.css)) over a live greyscale map.

These pages **do not change the production app**. They only add files under
`previews/`. Nothing here is wired to real logic; inputs, prices and dates are
illustrative. Camping names are real, taken from
[`../static/data/accueil_velo_housing.json`](../static/data/accueil_velo_housing.json).

## What's here

| File | Preview |
|------|---------|
| `itineraire.html` | **Recherche d'un point A à un point B** — search panel with the title, an "Itinéraire personnalisé" subtitle, and Départ / Arrivée fields. |
| `budget.html` | **Budget dans la recherche** — a result detail with a `💸 Budget : éco+` pill, a price on each train leg (`32 €` / `29 €`), and a camping-only night list (real camping names) over the red EV3 "Scandibérique" line. |
| `communaute.html` | **Fonctionnalités collaboratives** — a "Rejoignez la communauté Intercyclette !" modal with three emoji cards. |
| `preview.css` | The few new style rules these pages need (on top of `style.css`). |
| `preview-map.js` | Tiny Leaflet helper that reproduces the app's greyscale OSM-France backdrop and optionally draws one route. |

## How to view & screenshot

Serve the repository root (so `../static/...` resolves) and open the pages:

```bash
python3 -m http.server 8080
```

- http://localhost:8080/previews/itineraire.html
- http://localhost:8080/previews/budget.html
- http://localhost:8080/previews/communaute.html

Wait for the map tiles to load, then screenshot the browser window (crop to the
panel or modal as needed). A wide desktop window best matches the real app.

## Adjusting the content

All text/emoji are inline in the HTML. Common tweaks:

- **Prices** — the `.leg-price` spans in `budget.html`.
- **Camping names / per-day distances** — the `.housing-name` pills and the
  `🚲 N km` lines in `budget.html`.
- **Card emojis / labels** — the `.community-card` blocks in `communaute.html`.
- **Map framing** — the `center` / `zoom` / `routeId` passed to
  `initPreviewMap(...)` at the bottom of each page.
