# Intercyclette

Outil de recherche d'itinéraires **randovélo + train** en France.

Planifiez des séjours à vélo le long des routes Eurovelo en combinant les trains SNCF pour rejoindre et quitter le parcours.

---

## Architecture

```
Site statique (GitHub Pages / http.server)
  index.html
  static/data/stations.json          ← autocomplete gares
  static/data/route_stations.json    ← index gares ↔ routes
  static/data/routes/ev*.json        ← géométries colorées
  static/data/housing.json           ← hébergements ≤ 5 km des routes
  static/js/{map,planner,transitous,
    results,search}.js
  static/css/style.css
```

Aucun proxy, aucun token. Les horaires sont récupérés à la demande via l'**API Transitous** (`https://api.transitous.org`). Le navigateur envoie automatiquement l'en-tête `Referer`, ce qui satisfait la politique d'attribution de Transitous. Les correspondances (multi-trajets) sont prises en charge.

Le backend Flask (`app/`) est conservé uniquement pour le développement local (`flask run`).

---

## Ce que fait l'application

L'utilisateur renseigne :
- Sa **gare de départ** (ville de référence pour les trains)
- La **Durée du séjour** disponibles (1 à 15)
- Son **rythme de pédalage** (Escargot tranquille / Habitué des randovélo / Athlète olympique)
- Les **routes Eurovelo** souhaitées (sélection multiple)
- La **date de départ**

L'application :
1. Identifie les gares SNCF proches de chaque route Eurovelo sélectionnée
2. Cherche les trains aller et retour via l'API Transitous (avec correspondances)
3. Calcule la distance vélo réalisable selon le rythme
4. Affiche les itinéraires sous forme de cartes et sur une carte Leaflet/OpenStreetMap
   avec les 9 routes Eurovelo colorées en permanence

---

## Installation

```bash
git clone <repo>
cd intercyclette
pip3 install -r requirements.txt
```

---

## API Transitous

Les horaires de trains sont récupérés en temps réel via l'[API Transitous](https://transitous.org/api/) — un service de routage multimodal européen open-source basé sur MOTIS.

- Aucun token requis.
- L'en-tête `Referer` est envoyé automatiquement par le navigateur (politique d'attribution Transitous).
- Contact : karas.benjamin@gmail.com (requis par Transitous pour les apps browser).
- Supporte les correspondances (multi-trajets).

---

## Générer les fichiers statiques

### 1. Index de proximité gares ↔ routes

```bash
python3 scripts/preprocess.py
```

Parcourt les 9 fichiers GPX Eurovelo et les ~2 800 gares SNCF.
Résultat : `data/processed/route_stations.json`.

### 2. Exporter les autres données statiques

```bash
python3 scripts/export_stations_json.py      # → static/data/stations.json
python3 scripts/export_route_geometries.py   # → static/data/routes/ev*.json (×9)
python3 scripts/export_housing_json.py       # → static/data/housing.json
cp data/processed/route_stations.json static/data/route_stations.json
```

---

## Lancer l'application (site statique)

```bash
python3 -m http.server 8080
# Accéder à http://localhost:8080
```

Les recherches appellent l'API Transitous directement depuis le navigateur — aucune configuration supplémentaire requise.

---

## Lancer l'application (backend Flask, développement local)

```bash
flask --app app run
# Accéder à http://localhost:5000
```

---

## Lancer les tests

```bash
python3 -m pytest tests/ -v
```

Tous les tests sont isolés (pas de réseau, pas de fichiers externes réels).

---

## Structure du projet

```
intercyclette/
├── index.html                         Site statique (GitHub Pages)
├── data/
│   ├── raw/
│   │   ├── gares-de-voyageurs.geojson     Gares SNCF
│   │   ├── housing.geojson                Hébergements OSM (hôtels, campings, etc.)
│   │   ├── Eurovelo_France_gpx/           Traces GPX des 9 routes
│   └── processed/
│       └── route_stations.json            Index gares ↔ routes (avec track_points)
├── scripts/
│   ├── preprocess.py                  Pré-traitement GPX + gares (exécuté une fois)
│   ├── export_stations_json.py        Export → static/data/stations.json
│   ├── export_route_geometries.py     Export → static/data/routes/*.json
│   └── export_housing_json.py         Export hébergements → static/data/housing.json
├── app/
│   ├── constants.py                   Constantes, couleurs, chemins
│   ├── routes.py                      Handlers Flask (développement local)
│   ├── geo/
│   │   ├── distance.py                Géométrie pure (haversine, polyligne)
│   │   ├── gpx_parser.py             Lecture des fichiers GPX
│   │   ├── station_matcher.py        Correspondance gares ↔ routes
│   │   └── housing_matcher.py        Correspondance hébergements ↔ routes
│   └── itinerary/
│       ├── rhythm.py                  Calcul de distance selon le rythme
│       └── planner.py                 Assemblage des itinéraires candidats
├── static/
│   ├── css/style.css
│   ├── data/
│   │   ├── stations.json              Gares SNCF (autocomplete)
│   │   ├── route_stations.json        Index gares ↔ routes (site statique)
│   │   ├── housing.json               Hébergements ≤ 5 km des routes (site statique)
│   │   └── routes/                    Géométries colorées (9 fichiers)
│   └── js/
│       ├── map.js                     Carte Leaflet, overlays colorés, points hébergement
│       ├── planner.js                 Port JS du planificateur Python
│       ├── transitous.js              Client API Transitous (horaires en temps réel)
│       ├── results.js                 Rendu des cartes itinéraires
│       └── search.js                  Formulaire, autocomplétion, date FR, aide, orchestration
├── templates/
│   └── index.html                     Template Jinja2 (développement local Flask)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BUILD.md
│   └── DEPLOYMENT.md
└── tests/
    ├── fixtures/                      Données synthétiques pour les tests
    └── test_*.py                      Tests unitaires (un fichier par module)
```

---

## Pipeline de traitement

### Pré-traitement (scripts/preprocess.py + scripts/export_housing_json.py)

```
gares-de-voyageurs.geojson  +  Eurovelo_France_gpx/*.gpx
         │                              │
         ▼                              ▼
   Chargement des gares           Parsing GPX → GpxTrack
         │                              │
         └────────┬─────────────────────┘
                  ▼
     Pour chaque gare, pré-filtrage par boîte englobante
     puis calcul de distance exacte à la polyligne (≤ 5 km)
                  │
                  ▼
         route_stations.json  (index gares ↔ routes, track_points)

housing.geojson  +  Eurovelo_France_gpx/*.gpx
         │                 │
         ▼                 ▼
   Chargement OSM    Parsing GPX → GpxTrack
         │                 │
         └────────┬─────────┘
                  ▼
     find_features_near_route() — même logique boîte englobante
     Déduplication par osm_id (première occurrence gagne)
                  │
                  ▼
         static/data/housing.json  (tableau plat d'hébergements ≤ 5 km)
```

### Recherche (navigateur + API Transitous)

```
[Formulaire utilisateur]
        │
        ▼
[Chargement local route_stations.json + stations.json]
        │
        ▼
[planner.js — calcul pur JS, sans réseau]
   Stations de départ dans la "zone initiale" (15 %, max 100 km)
   Triées par distance à la gare de départ
   Distance vélo = (n_jours - 1) × km_par_jour  [pour n_jours ≥ 2]
        │
        ▼
[transitous.js — appels API Transitous]
   queryJourney(fromLat, fromLon, toLat, toLon, isoDatetime)
   GET https://api.transitous.org/api/v5/plan
   → meilleurs itinéraires (avec correspondances)
        │
        ▼
[Frontend : affichage liste + carte Leaflet/OSM]
   9 overlays colorés permanents (un par route Eurovelo)
   Points hébergements bleus pâles permanents (housing.json)
   Segment bikeé en couleur de la route sélectionnée
```

### Rythmes de pédalage

| Clé | Label | Vitesse | Heures/jour | km/jour |
|---|---|---|---|---|
| `escargot` | Escargot tranquille | 12 km/h | 5h | 60 km |
| `randonneur` | Habitué des randovélo | 15 km/h | 6,5h | 97,5 km |
| `athlete` | Athlète olympique | 20 km/h | 8h | 160 km |

---

## Routes Eurovelo disponibles

| ID | Nom | Couleur |
|---|---|---|
| EV3 | La Scandibérique | Rouge |
| EV4 | La Vélomaritime | Bleu |
| EV5 | Eurovelo 5 Moselle Alsace | Cyan |
| EV6 | Entre Rhin et Loire à Vélo | Violet |
| EV8 | La Méditerranée à Vélo | Sarcelle |
| EV15 | Véloroute du Rhin | Ambre |
| EV19 | La Meuse à Vélo | Vert |
| VEL | La Vélodyssée | Rose |
| VIA | ViaRhôna | Orange |

---

## Déploiement

Site entièrement statique — déployable sur GitHub Pages, Netlify, ou tout hébergeur
de fichiers statiques. Aucun serveur proxy requis.

Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour les détails.

---

## Développements futurs envisagés

- Itinéraire entre deux villes (départ ≠ arrivée)
- Affichage du type de train (TER / Intercités) sur chaque carte
- Filtrage par type de train dans le formulaire
