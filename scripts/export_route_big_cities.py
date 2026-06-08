"""
Export the big-city "hub" train stations near each Eurovelo route.

Reads the precomputed route→stations proximity index and, for each route, keeps
only the stations that belong to a curated list of major rail-hub cities (Paris,
Lyon, Bordeaux, Strasbourg, …). Stations are grouped by city; the representative
station of a city is the one closest to the route line (smallest
distance_to_route_km). The result feeds the frontend's hub-based outbound train
search (static/js/trip_optimizer.js), which queries the user → the 5 hubs nearest
the user on each selected route.

Matching rule: a station belongs to a city when its (accent-folded) name *starts
with* the city name followed by a word boundary (space, hyphen or end). This
prefix rule keeps "Paris Gare de Lyon" / "Corbeil-Essonnes" but rejects
"Villeparisis …" (not Paris), "Ingrandes sur Vienne" (not Vienne) and
"Herrlisheim-près-Colmar" (not Colmar).

Usage:
    python3 scripts/export_route_big_cities.py

Input:  static/data/route_stations.json
Output: static/data/route_big_cities.json
"""

import json
import os
import unicodedata

INPUT_PATH = "static/data/route_stations.json"
OUTPUT_PATH = "static/data/route_big_cities.json"

# Curated major rail-hub cities (names chosen so the prefix rule matches the real
# city stations and not nearby villages). Order does not matter.
BIG_CITIES = [
    "Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes",
    "Strasbourg", "Montpellier", "Nice", "Rennes", "Reims", "Le Havre", "Grenoble",
    "Dijon", "Tours", "Orleans", "Amiens", "Metz", "Besancon", "Perpignan", "Caen",
    "Mulhouse", "Nancy", "Rouen", "Avignon", "Poitiers", "La Rochelle", "Pau",
    "Bayonne", "Annecy", "Chambery", "Valence", "Arles", "Troyes", "Bourges",
    "Nevers", "Macon", "Chalon", "Sete", "Beziers", "Narbonne", "Agde", "Morlaix",
    "Brest", "Quimper", "Lorient", "Vannes", "Saint-Brieuc", "Saintes", "Angouleme",
    "Niort", "Saumur", "Blois", "Colmar", "Selestat", "Belfort", "Montbeliard",
    "Dunkerque", "Calais", "Boulogne", "Charleville", "Sedan", "Verdun", "Epinal",
    "Roscoff", "Hendaye", "Biarritz", "Dax", "Cholet", "Compiegne", "Creil",
    "Sens", "Auxerre", "Moulins", "Vienne", "Tain", "Tarascon", "Beaucaire",
    "Carcassonne", "Chartres", "Etampes", "Fontainebleau", "Melun", "Corbeil",
    "Maubeuge", "Hirson", "Givet",
]


def fold(text):
    """
    Lower-case and strip accents from a string for robust matching.

    Args:
        text: Arbitrary string.

    Returns:
        Accent-folded, lower-cased string.
    """
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def matched_city(station_name, folded_cities):
    """
    Return the city a station name belongs to, or None.

    A station matches a city when its folded name starts with the folded city
    name followed by a word boundary (end of string, space or hyphen).

    Args:
        station_name: Raw station name (e.g. "Paris Gare de Lyon").
        folded_cities: List of (city, folded_city) tuples.

    Returns:
        The original city string of the first match, or None.
    """
    name = fold(station_name)
    for city, cfold in folded_cities:
        if name == cfold:
            return city
        if name.startswith(cfold):
            nxt = name[len(cfold)]
            if nxt in (" ", "-"):
                return city
    return None


def build_big_cities(index):
    """
    Build the per-route hub-city mapping from the proximity index.

    Args:
        index: Parsed route_stations.json dict (has a "routes" map).

    Returns:
        Dict mapping route_id -> list of hub entries, each with the
        representative station fields plus an "all" list of the city's stations,
        sorted by the representative cumulative_km.
    """
    folded_cities = [(c, fold(c)) for c in BIG_CITIES]
    result = {}
    for route_id, route in index.get("routes", {}).items():
        by_city = {}
        for station in route.get("stations", []):
            city = matched_city(station["nom"], folded_cities)
            if city is None:
                continue
            entry = {
                "nom": station["nom"],
                "uic": (station.get("codes_uic") or [""])[0],
                "lat": station["lat"],
                "lon": station["lon"],
                "cumulative_km": station["cumulative_km"],
                "distance_to_route_km": station["distance_to_route_km"],
            }
            by_city.setdefault(city, []).append(entry)

        hubs = []
        for city, stations in by_city.items():
            stations.sort(key=lambda s: s["distance_to_route_km"])
            rep = stations[0]
            hubs.append({
                "city": city,
                "nom": rep["nom"],
                "uic": rep["uic"],
                "lat": rep["lat"],
                "lon": rep["lon"],
                "cumulative_km": rep["cumulative_km"],
                "distance_to_route_km": rep["distance_to_route_km"],
                "stations": sorted(stations, key=lambda s: s["cumulative_km"]),
            })
        hubs.sort(key=lambda h: h["cumulative_km"])
        result[route_id] = hubs
    return result


def main():
    """Read the proximity index, build the hub mapping, and write the JSON."""
    with open(INPUT_PATH, encoding="utf-8") as f:
        index = json.load(f)
    big_cities = build_big_cities(index)
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(big_cities, f, ensure_ascii=False, indent=1)
    total = sum(len(v) for v in big_cities.values())
    print(f"Wrote {OUTPUT_PATH}: {len(big_cities)} routes, {total} hub cities.")
    for route_id, hubs in big_cities.items():
        print(f"  {route_id}: {', '.join(h['city'] for h in hubs)}")


if __name__ == "__main__":
    main()
