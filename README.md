# Intercyclette

Outil de recherche d'itinéraires **randovélo + train** en France.

Planifiez des séjours à vélo le long des routes Eurovelo en combinant les trains SNCF pour rejoindre et quitter le parcours.

---

## Architecture

```
GitHub Pages (static)          Proxy (Render.com / Railway)
  index.html                     proxy/app.py  (~40 lignes Flask)
  static/data/stations.json  →   POST /navitia/journey
  static/data/route_stations.json   ↓
  static/data/routes/ev*.json    Navitia API (SNCF)
  static/js/{map,planner,       (token dans variable d'environnement)
    journey_parser,results,
    search}.js
  static/css/style.css
```

Le backend Flask original (`app/`) est conservé pour le développement local.

---

## Ce que fait l'application

L'utilisateur renseigne :
- Sa **gare de départ** (ville de référence pour les trains)
- Le **nombre de jours** disponibles (1 à 15)
- Son **rythme de pédalage** (Escargot tranquille / Habitué des randovélo / Athlète olympique)
- Les **routes Eurovelo** souhaitées (sélection multiple)

L'application :
1. Identifie les gares SNCF proches de chaque route Eurovelo sélectionnée
2. Interroge l'API SNCF (Navitia) via le proxy pour trouver les trains aller et retour
3. Calcule la distance vélo réalisable selon le rythme
4. Affiche les itinéraires sous forme de cartes et sur une carte Leaflet/OpenStreetMap
   avec les 9 routes Eurovelo colorées, fond de carte gris en français, panneaux
   d'info au survol de chaque route, et bouton d'aide intégré

---

## Installation

```bash
git clone <repo>
cd intercyclette
pip3 install -r requirements.txt
```

---

## Générer les fichiers statiques

### 1. Index de proximité gares ↔ routes (une seule fois)

```bash
python3 scripts/preprocess.py
```

Parcourt les 9 fichiers GPX Eurovelo et les ~2 800 gares SNCF.
Résultat : `data/processed/route_stations.json` (~360 Ko, inclut les points de trace).

### 2. Exporter les données statiques

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

Pour les recherches, configurer l'URL du proxy via le bouton ⚙ en haut à droite.

### Lancer le proxy localement

```bash
cd proxy
NAVITIA_TOKEN=votre_token python3 app.py
# Proxy disponible sur http://localhost:5001
```

Entrer `http://localhost:5001` dans le panneau de paramètres.

---

## Lancer l'application (backend Flask, alternative)

```bash
export NAVITIA_TOKEN=votre_token
flask --app app run
# Accéder à http://localhost:5000
```

Obtenez un token sur [https://www.navitia.io](https://www.navitia.io).

---

## Lancer les tests

```bash
python3 -m pytest tests/ -v
```

Tous les tests sont isolés (pas de réseau, pas de fichiers réels).

---

## Structure du projet

```
intercyclette/
├── index.html                       Site statique (GitHub Pages)
├── data/
│   ├── raw/
│   │   ├── gares-de-voyageurs.geojson   Gares SNCF
│   │   └── Eurovelo_France_gpx/         Traces GPX des 9 routes
│   └── processed/
│       └── route_stations.json          Index gares ↔ routes (avec track_points)
├── scripts/
│   ├── preprocess.py                    Pré-traitement (exécuté une fois)
│   ├── export_stations_json.py          Export → static/data/stations.json
│   └── export_route_geometries.py       Export → static/data/routes/*.json
├── proxy/
│   ├── app.py                           Proxy Navitia (~40 lignes Flask)
│   └── requirements.txt
├── app/
│   ├── constants.py                     Constantes et couleurs des routes
│   ├── routes.py                        Handlers Flask (dev local)
│   ├── geo/
│   │   ├── distance.py                  Géométrie pure (haversine, polyligne)
│   │   ├── gpx_parser.py               Lecture des fichiers GPX
│   │   └── station_matcher.py          Correspondance gares ↔ routes
│   ├── itinerary/
│   │   ├── rhythm.py                   Calcul de distance selon le rythme
│   │   └── planner.py                  Assemblage des itinéraires candidats
│   └── navitia/
│       ├── client.py                   Client HTTP Navitia
│       └── journey_parser.py           Parseur des réponses Navitia
├── static/
│   ├── css/style.css
│   ├── data/
│   │   ├── stations.json               Gares SNCF (autocomplete)
│   │   ├── route_stations.json         Index gares ↔ routes (site statique)
│   │   └── routes/                     Géométries colorées (9 fichiers)
│   └── js/
│       ├── map.js                      Carte Leaflet, overlays colorés, hover info, fond gris FR
│       ├── planner.js                  Port JS du planificateur Python
│       ├── journey_parser.js           Port JS du parseur Navitia
│       ├── results.js                  Rendu des cartes itinéraires
│       └── search.js                   Formulaire, autocomplétion, date FR, aide, orchestration
├── templates/
│   └── index.html                      Template Jinja2 (dev local Flask)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BUILD.md
│   └── DEPLOYMENT.md
└── tests/                              Tests unitaires (un fichier par module)
```

---

## Pipeline de traitement

### Pré-traitement (scripts/preprocess.py)

```
gares-de-voyageurs.geojson  +  Eurovelo_France_gpx/*.gpx
         │                              │
         ▼                              ▼
   Chargement des gares           Parsing GPX → GpxTrack
         │                              │
         └────────┬─────────────────────┘
                  ▼
     Pour chaque gare, pré-filtrage par boîte englobante
     puis calcul de distance exacte à la polyligne
                  │
                  ▼  (si ≤ 5 km)
     StationOnRoute : nom, UIC, lat/lon, km cumulé sur la route
     + track_points downsampled (300 pts) pour l'overlay carte
                  │
                  ▼
         route_stations.json
```

### Recherche (site statique)

```
[Formulaire utilisateur]
        │
        ▼
[Chargement local route_stations.json + stations.json]
        │
        ▼
[planner.js — calcul pur JS, sans réseau]
   Stations de départ dans la "zone initiale" (15%, max 100 km)
   Triées par distance à la gare de départ
   Distance vélo = (n_jours - 1) × km_par_jour  [pour n_jours ≥ 2]
        │
        ▼
[Appels proxy — 2 requêtes par candidat]
   POST proxy/navitia/journey  (aller : gare départ → gare route)
   POST proxy/navitia/journey  (retour : gare route → gare départ)
        │
        ▼
[journey_parser.js — parsing réponses Navitia]
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

Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour le déploiement GitHub Pages + proxy Render.com/Railway.

---

## Développements futurs envisagés

- Recherche de logements le long des routes Eurovelo
- Itinéraire entre deux villes (départ ≠ arrivée)
- Filtrage par types de trains (TER favorisés, TGV exclus) pour le transport de vélo
