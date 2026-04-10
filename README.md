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
  static/data/timetable.json         ← horaires GTFS compilés
  static/data/routes/ev*.json        ← géométries colorées
  static/js/{map,planner,timetable,
    results,search}.js
  static/css/style.css
```

Entièrement statique — aucun proxy, aucun token, aucune requête réseau après le chargement initial des fichiers JSON.

Le backend Flask (`app/`) est conservé uniquement pour le développement local (`flask run`).

---

## Ce que fait l'application

L'utilisateur renseigne :
- Sa **gare de départ** (ville de référence pour les trains)
- Le **nombre de jours** disponibles (1 à 15)
- Son **rythme de pédalage** (Escargot tranquille / Habitué des randovélo / Athlète olympique)
- Les **routes Eurovelo** souhaitées (sélection multiple)
- La **date de départ**

L'application :
1. Identifie les gares SNCF proches de chaque route Eurovelo sélectionnée
2. Cherche les trains aller et retour directement dans l'index GTFS (TER et Intercités)
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

## Données GTFS SNCF

Les horaires de trains sont calculés à partir des données GTFS de SNCF Open Data.
Téléchargez l'archive GTFS depuis [data.sncf.com](https://data.sncf.com) et extrayez-la dans :

```
data/raw/Export_OpenData_SNCF_GTFS_NewTripId/
```

Seuls les trains **TER** et **Intercités** (qui acceptent les vélos) sont retenus.
Les stops IDs des types retenus suivent les préfixes :
- `StopPoint:OCETrain TER-87…`
- `StopPoint:OCEINTERCITES-87…`

---

## Générer les fichiers statiques

### 1. Index de proximité gares ↔ routes

```bash
python3 scripts/preprocess.py
```

Parcourt les 9 fichiers GPX Eurovelo et les ~2 800 gares SNCF.
Résultat : `data/processed/route_stations.json`.

### 2. Index horaires GTFS

```bash
python3 scripts/build_gtfs_index.py
```

Lit les fichiers GTFS, filtre TER + Intercités, France uniquement.
Résultat : `static/data/timetable.json` (~5–15 Mo selon la période).
Affiche des statistiques (nombre de trajets, plage de dates, taille).

### 3. Exporter les autres données statiques

```bash
python3 scripts/export_stations_json.py      # → static/data/stations.json
python3 scripts/export_route_geometries.py   # → static/data/routes/ev*.json (×9)
cp data/processed/route_stations.json static/data/route_stations.json
```

---

## Lancer l'application (site statique)

```bash
python3 -m http.server 8080
# Accéder à http://localhost:8080
```

Les recherches fonctionnent sans configuration supplémentaire — les horaires
sont lus depuis `static/data/timetable.json`.

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

Tous les tests sont isolés (pas de réseau, pas de fichiers GTFS réels).

---

## Structure du projet

```
intercyclette/
├── index.html                         Site statique (GitHub Pages)
├── data/
│   ├── raw/
│   │   ├── gares-de-voyageurs.geojson     Gares SNCF
│   │   ├── Eurovelo_France_gpx/           Traces GPX des 9 routes
│   │   └── Export_OpenData_SNCF_GTFS_NewTripId/   Données GTFS SNCF
│   └── processed/
│       └── route_stations.json            Index gares ↔ routes (avec track_points)
├── scripts/
│   ├── preprocess.py                  Pré-traitement GPX + gares (exécuté une fois)
│   ├── build_gtfs_index.py            Compilation de l'index GTFS → timetable.json
│   ├── export_stations_json.py        Export → static/data/stations.json
│   └── export_route_geometries.py     Export → static/data/routes/*.json
├── app/
│   ├── constants.py                   Constantes, couleurs, chemins GTFS
│   ├── routes.py                      Handlers Flask (développement local)
│   ├── geo/
│   │   ├── distance.py                Géométrie pure (haversine, polyligne)
│   │   ├── gpx_parser.py             Lecture des fichiers GPX
│   │   └── station_matcher.py        Correspondance gares ↔ routes
│   └── itinerary/
│       ├── rhythm.py                  Calcul de distance selon le rythme
│       └── planner.py                 Assemblage des itinéraires candidats
├── static/
│   ├── css/style.css
│   ├── data/
│   │   ├── stations.json              Gares SNCF (autocomplete)
│   │   ├── route_stations.json        Index gares ↔ routes (site statique)
│   │   ├── timetable.json             Index horaires GTFS compilé
│   │   └── routes/                    Géométries colorées (9 fichiers)
│   └── js/
│       ├── map.js                     Carte Leaflet, overlays colorés, fond gris FR
│       ├── planner.js                 Port JS du planificateur Python
│       ├── timetable.js               Moteur de recherche GTFS en navigateur
│       ├── results.js                 Rendu des cartes itinéraires
│       └── search.js                  Formulaire, autocomplétion, date FR, aide, orchestration
├── templates/
│   └── index.html                     Template Jinja2 (développement local Flask)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BUILD.md
│   └── DEPLOYMENT.md
└── tests/
    ├── fixtures/gtfs/                 Données GTFS synthétiques pour les tests
    └── test_*.py                      Tests unitaires (un fichier par module)
```

---

## Pipeline de traitement

### Pré-traitement (scripts/preprocess.py + build_gtfs_index.py)

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

Export_OpenData_SNCF_GTFS_NewTripId/
         │
         ▼  (filtrage TER + Intercités, UIC 87xxxxx uniquement)
   stops.txt → stop_id → uic
   trips.txt → trip_id → service_id
   stop_times.txt → trip_id → [(uic, dep_min), ...]   (streamed, 72 Mo)
   calendar_dates.txt → service_id → [dates]
   gares-de-voyageurs.geojson → alias UIC geojson → UIC GTFS (par nom normalisé)
         │
         ▼
   timetable.json  (services compactés, clés entières courtes, uic_aliases)
```

### Recherche (navigateur, entièrement statique)

```
[Formulaire utilisateur]
        │
        ▼
[Chargement local route_stations.json + stations.json + timetable.json]
        │
        ▼
[planner.js — calcul pur JS, sans réseau]
   Stations de départ dans la "zone initiale" (15 %, max 100 km)
   Triées par distance à la gare de départ
   Distance vélo = (n_jours - 1) × km_par_jour  [pour n_jours ≥ 2]
        │
        ▼
[timetable.js — lookup GTFS en mémoire]
   queryJourney(fromUic, toUic, dateInt, afterMinutes)
   → premiers trains directs TER / Intercités
        │
        ▼
[Frontend : affichage liste + carte Leaflet/OSM]
   9 overlays colorés permanents (un par route Eurovelo)
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
| EV5 | Eurovelo 5 Moselle Alsace | Orange |
| EV6 | Entre Rhin et Loire à Vélo | Violet |
| EV8 | La Méditerranée à Vélo | Sarcelle |
| EV15 | Véloroute du Rhin | Ambre |
| EV19 | La Meuse à Vélo | Vert |
| VEL | La Vélodyssée | Rose |
| VIA | ViaRhôna | Cyan |

---

## Déploiement

Site entièrement statique — déployable sur GitHub Pages, Netlify, ou tout hébergeur
de fichiers statiques. Aucun serveur proxy requis.

Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour les détails.

---

## Développements futurs envisagés

- Recherche de logements le long des routes Eurovelo
- Itinéraire entre deux villes (départ ≠ arrivée)
- Affichage du type de train (TER / Intercités) sur chaque carte
- Filtrage par type de train dans le formulaire
