# Intercyclette

Outil de recherche d'itinéraires **randovélo + train** en France.

Planifiez des séjours à vélo le long des routes Eurovelo en combinant les trains SNCF pour rejoindre et quitter le parcours.

---

## Ce que fait l'application

L'utilisateur renseigne :
- Sa **gare de départ** (ville de référence pour les trains)
- Le **nombre de jours** disponibles (1 à 15)
- Son **rythme de pédalage** (Escargot tranquille / Habitué des randovélo / Athlète olympique)
- Les **routes Eurovelo** souhaitées (sélection multiple)

L'application :
1. Identifie les gares SNCF proches de chaque route Eurovelo sélectionnée
2. Interroge l'API SNCF (Navitia) pour trouver les trains aller et retour
3. Calcule la distance vélo réalisable selon le rythme
4. Affiche les itinéraires sous forme de cartes sur une liste et sur une carte interactive

---

## Installation

```bash
git clone <repo>
cd intercyclette
pip3 install -r requirements.txt
```

---

## Lancer l'application

### 1. Générer l'index de proximité gares ↔ routes (une seule fois)

```bash
python3 scripts/preprocess.py
```

Ce script parcourt les 9 fichiers GPX Eurovelo et les ~2 800 gares SNCF pour identifier
toutes les gares situées à moins de 5 km d'une route. Résultat écrit dans
`data/processed/route_stations.json` (~quelques minutes selon le matériel).

Options disponibles :
```bash
python3 scripts/preprocess.py --max-distance 3.0   # changer le seuil de proximité
python3 scripts/preprocess.py --help               # voir tous les paramètres
```

### 2. Configurer le token Navitia

```bash
export NAVITIA_TOKEN=votre_token_navitia
```

Obtenez un token sur [https://www.navitia.io](https://www.navitia.io).

### 3. Démarrer le serveur Flask

```bash
flask --app app run
# ou
python3 -m flask --app app run
```

Accédez à [http://localhost:5000](http://localhost:5000).

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
├── data/
│   ├── raw/
│   │   ├── gares-de-voyageurs.geojson   Gares SNCF (source Transpor.t data.gouv.fr)
│   │   └── Eurovelo_France_gpx/         Traces GPX des 9 routes Eurovelo en France
│   └── processed/
│       └── route_stations.json          Index gares ↔ routes (généré par preprocess.py)
├── scripts/
│   └── preprocess.py                    Script de pré-traitement (exécuté une fois)
├── app/
│   ├── constants.py                     Toutes les constantes et valeurs de configuration
│   ├── routes.py                        Handlers Flask (endpoints HTTP)
│   ├── geo/
│   │   ├── distance.py                  Fonctions géométriques pures (haversine, polyline)
│   │   ├── gpx_parser.py               Lecture des fichiers GPX
│   │   └── station_matcher.py          Correspondance gares ↔ routes
│   ├── itinerary/
│   │   ├── rhythm.py                   Calcul de distance selon le rythme
│   │   └── planner.py                  Assemblage des itinéraires candidats
│   └── navitia/
│       ├── client.py                   Client HTTP Navitia (appels API)
│       └── journey_parser.py           Parseur des réponses Navitia
├── static/
│   ├── css/style.css
│   └── js/
│       ├── map.js                      Carte Leaflet + OpenStreetMap
│       ├── results.js                  Rendu des cartes itinéraires
│       └── search.js                   Formulaire + autocomplétion
├── templates/
│   └── index.html                      Page HTML unique
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
                  │
                  ▼
         route_stations.json
```

### Recherche (requête /api/search)

```
[Formulaire utilisateur]
        │
        ▼
[Validation de la requête]
        │
        ▼
[Chargement de l'index route_stations.json]
        │
        ▼
[Sélection des gares candidates]
   Gares dans la "zone de départ" de la route (15% initial, max 100 km)
   Triées par distance à la ville de départ de l'utilisateur
        │
        ▼
[Calcul de la distance vélo]
   total_km = (n_jours - 1) × km_par_jour  [pour n_jours ≥ 2]
   total_km = 0.5 × km_par_jour            [pour n_jours = 1]
        │
        ▼
[Recherche des trains — 6 appels API Navitia par route sélectionnée]
   3 appels aller : gare de départ → 3 gares candidates route
   3 appels retour : 3 gares fin de parcours → gare de départ
        │
        ▼
[Assemblage des cartes itinéraires]
   route + gares + trains + géométrie (réduite à ≤1000 points)
        │
        ▼
[Frontend : affichage liste + carte Leaflet/OSM]
```

### Rythmes de pédalage

| Clé | Label | Vitesse | Heures/jour | km/jour |
|---|---|---|---|---|
| `escargot` | Escargot tranquille | 12 km/h | 5h | 60 km |
| `randonneur` | Habitué des randovélo | 15 km/h | 6,5h | 97,5 km |
| `athlete` | Athlète olympique | 20 km/h | 8h | 160 km |

---

## Routes Eurovelo disponibles

| ID | Nom |
|---|---|
| EV3 | La Scandibérique |
| EV4 | La Vélomaritime |
| EV5 | Eurovelo 5 Moselle Alsace |
| EV6 | Entre Rhin et Loire à Vélo |
| EV8 | La Méditerranée à Vélo |
| EV15 | Véloroute du Rhin |
| EV19 | La Meuse à Vélo |
| VEL | La Vélodyssée |
| VIA | ViaRhôna |

---

## Développements futurs envisagés

- Recherche de logements le long des routes Eurovelo
- Itinéraire entre deux villes (départ ≠ arrivée)
- Filtrage par types de trains (TER favorisés, TGV exclus) pour le transport de vélo
