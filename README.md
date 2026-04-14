# Intercyclette

Outil de recherche d'itinéraires **randovélo + train** en France.

Planifiez des séjours à vélo le long des routes Eurovelo en combinant les trains SNCF pour rejoindre et quitter le parcours.

**Site web : [komorebi-32.github.io/intercyclette](https://komorebi-32.github.io/intercyclette/)**

---

## Fonctionnalités

- **Recherche d'itinéraires randovélo + train** : indiquez votre ville de départ, la durée de votre séjour, votre rythme de pédalage et les routes Eurovelo souhaitées. L'outil identifie les gares SNCF proches des routes et recherche les trains aller-retour via l'API Transitous (avec correspondances).
- **Bilan carbone** : chaque itinéraire détaillé affiche l'empreinte carbone des trajets en train (facteurs ADEME Base Empreinte 2023) et les émissions évitées par rapport à un vol aller-retour Paris–Madrid.
- **Hébergements sur la carte** : les hébergements situés à moins de 5 km des routes Eurovelo sont affichés sur la carte (OpenStreetMap et label Accueil Vélo), avec coordonnées de contact au survol.
- **Restaurants labellisés Accueil Vélo** : les restaurants labellisés Accueil Vélo à moins de 5 km des routes sont également affichables sur la carte.

---

## Architecture

```
Site statique (GitHub Pages / http.server)
  index.html
  static/data/stations.json          ← autocomplete gares
  static/data/route_stations.json    ← index gares ↔ routes
  static/data/routes/ev*.json        ← géométries colorées
  static/data/housing.json           ← hébergements OSM ≤ 5 km des routes
  static/data/accueil_velo_housing.json     ← hébergements Accueil Vélo ≤ 5 km
  static/data/accueil_velo_restaurants.json ← restaurants Accueil Vélo ≤ 5 km
  static/js/{map,planner,transitous,
    co2,results,search}.js
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
4. Calcule l'empreinte carbone des trajets en train et les émissions évitées vs. vol Madrid A/R
5. Affiche les itinéraires sous forme de cartes et sur une carte Leaflet/OpenStreetMap
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
python3 scripts/export_accueil_velo_json.py  # → static/data/accueil_velo_housing.json
                                             #   static/data/accueil_velo_restaurants.json
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
│   ├── export_housing_json.py         Export hébergements OSM → static/data/housing.json
│   └── export_accueil_velo_json.py    Export Accueil Vélo → housing + restaurants JSON
├── app/
│   ├── constants.py                   Constantes, couleurs, chemins
│   ├── routes.py                      Handlers Flask (développement local)
│   ├── geo/
│   │   ├── distance.py                Géométrie pure (haversine, polyligne)
│   │   ├── gpx_parser.py             Lecture des fichiers GPX
│   │   ├── station_matcher.py        Correspondance gares ↔ routes
│   │   ├── housing_matcher.py        Correspondance hébergements OSM ↔ routes
│   │   └── accueil_velo_matcher.py   Correspondance Accueil Vélo CSV ↔ routes
│   └── itinerary/
│       ├── rhythm.py                  Calcul de distance selon le rythme
│       └── planner.py                 Assemblage des itinéraires candidats
├── static/
│   ├── css/style.css
│   ├── data/
│   │   ├── stations.json              Gares SNCF (autocomplete)
│   │   ├── route_stations.json        Index gares ↔ routes (site statique)
│   │   ├── housing.json               Hébergements OSM ≤ 5 km des routes
│   │   ├── accueil_velo_housing.json  Hébergements Accueil Vélo ≤ 5 km des routes
│   │   ├── accueil_velo_restaurants.json  Restaurants Accueil Vélo ≤ 5 km des routes
│   │   └── routes/                    Géométries colorées (9 fichiers)
│   └── js/
│       ├── map.js                     Carte Leaflet, overlays colorés, points hébergement
│       ├── planner.js                 Port JS du planificateur Python
│       ├── transitous.js              Client API Transitous (horaires en temps réel)
│       ├── co2.js                     Calcul d'empreinte carbone et émissions évitées
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

### Pré-traitement (scripts/preprocess.py + scripts/export_housing_json.py + scripts/export_accueil_velo_json.py)

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
         static/data/housing.json  (tableau plat d'hébergements OSM ≤ 5 km)

accueil-velo.csv  +  Eurovelo_France_gpx/*.gpx
         │                    │
         ▼                    ▼
   Chargement CSV        Parsing GPX → GpxTrack
   Filtre Sous-type           │
   "Hébergement" / "Restauration"
         │                    │
         └────────┬────────────┘
                  ▼
     find_features_near_route() — même logique de proximité
     Déduplication par Identifiant (première occurrence gagne)
                  │
                  ▼
         static/data/accueil_velo_housing.json     (≈ 1 978 hébergements)
         static/data/accueil_velo_restaurants.json (≈ 425 restaurants)
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
[co2.js — calcul pur JS, sans réseau]
   computeJourneyCo2(journey)  →  Σ (facteur_train × distance_km) par segment
   computeAvoidedCo2(outboundCo2, returnCo2)  →  388 kg CO2e − total train
   Facteurs ADEME 2023 : TGV 1,73 g/km · Intercités 5,14 g/km · TER 24,4 g/km
        │
        ▼
[Frontend : affichage liste + carte Leaflet/OSM]
   9 overlays colorés permanents (un par route Eurovelo)
   Points hébergements OSM bleus pâles (housing.json)
   Points hébergements Accueil Vélo verts pâles (accueil_velo_housing.json)
   Points restaurants Accueil Vélo 🍴 (accueil_velo_restaurants.json)
   Segment bikeable en couleur de la route sélectionnée
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

- **Diversification de la recherche d'itinéraire** : nouvelle option permettant de sélectionner une ville de départ et une ville d'arrivée, l'outil identifiant la route Eurovelo la plus adaptée et calculant la durée du séjour en résultat.
- **Informations sur le transport de vélo** : affichage du type de train (TER, Intercités, Ouigo Train Classique), du coût et des modalités de réservation pour le transport du vélo. Priorisation des trains les plus adaptés aux vélos.
- **Intégration des hébergements dans les itinéraires** : pour les séjours de 2 jours ou plus, proposition directe d'hébergements à moins de 5 km de la route, adaptée au rythme du cycliste et aux km parcourus par jour.
- **Points d'intérêt touristique** : extraction depuis la base DATAtourisme, classés par type, affichables/masquables sur la carte avec informations pratiques au survol.
- **Points d'eau et toilettes** : affichage des ressources indispensables aux cyclistes (sources de données à identifier).
- **Fonctionnalités collaboratives** : propositions d'itinéraires personnalisés, commentaires, notes, signalement de points d'intérêt ou de dangers.

### Bugs connus

- Beaucoup d'hébergements affichés n'ont pas de coordonnées de contact (à corriger via DATAtourisme).
- L'affichage des hébergements peut provoquer des ralentissements lors du déplacement de la carte.
- Certains horaires de train identifiés ne sont pas valides (communication avec l'API Transitous à améliorer).
- Pour un séjour d'1 jour, le train retour peut partir avant que le cycliste ait le temps d'arriver à la gare.
- Les segments proposés partent toujours de la même gare SNCF ; il serait plus pertinent de varier selon la proximité géographique du départ ou l'intérêt touristique.
- Certains hébergements apparaissent en doublon (présents à la fois dans OpenStreetMap et DATAtourisme via le label Accueil Vélo).
