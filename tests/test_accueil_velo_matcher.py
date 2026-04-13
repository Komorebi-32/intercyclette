"""
Unit tests for app.geo.accueil_velo_matcher.

All tests use synthetic data — no real CSV or GPX files are read.
"""

import csv
import io
import json
import os
import tempfile

import pytest

from app.geo.accueil_velo_matcher import (
    load_accueil_velo_csv,
    filter_by_sous_type,
    _extract_first_url,
    _row_to_feature,
    find_accueil_velo_near_route,
    serialize_accueil_velo_points,
    AccueilVeloPoint,
)
from app.geo.gpx_parser import GpxTrack
from app.geo.distance import cumulative_distances_km


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CSV_HEADER = (
    '"Nom","Identifiant","Type","Sous-type","Sous-type","Commune",'
    '"Code postal","Code INSEE","Département","Région",'
    '"Latitude","Longitude","Site internet","Créateur","Mise à jour","Mise à jour DATAtourisme"'
)


def _make_csv_row(
    nom: str = "Test",
    identifiant: str = "ID001",
    sous_type_1: str = "Hébergement",
    sous_type_2: str = "Hébergement locatif",
    lat: str = "47.0",
    lon: str = "2.0",
    website: str = "https://example.com",
) -> str:
    """Build one quoted CSV data row matching the Accueil Vélo schema."""
    return (
        f'"{nom}","{identifiant}","Lieu","{sous_type_1}","{sous_type_2}",'
        f'"Commune","75000","75056","Paris","Île-de-France",'
        f'"{lat}","{lon}","{website}","Créateur","2026-01-01","2026-01-02"'
    )


def _write_csv(rows_content: list[str]) -> str:
    """Write a CSV file (header + rows) to a temp path and return the path."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    lines = [_CSV_HEADER] + rows_content
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


def _make_track(points: list[tuple[float, float]]) -> GpxTrack:
    """Build a GpxTrack from a list of (lat, lon) points."""
    cum = cumulative_distances_km(points)
    return GpxTrack(
        route_id="TST",
        name="Test Route",
        points=points,
        total_km=cum[-1],
    )


# ---------------------------------------------------------------------------
# TestLoadAccueilVeloCsv
# ---------------------------------------------------------------------------

class TestLoadAccueilVeloCsv:
    def test_returns_list_of_dicts(self):
        """A single data row should return one dict."""
        path = _write_csv([_make_csv_row(identifiant="A1")])
        try:
            rows = load_accueil_velo_csv(path)
            assert len(rows) == 1
            assert rows[0]["Identifiant"] == "A1"
        finally:
            os.unlink(path)

    def test_file_not_found_raises(self):
        with pytest.raises(FileNotFoundError):
            load_accueil_velo_csv("/tmp/does_not_exist_xyz.csv")

    def test_header_only_returns_empty(self):
        """A CSV with only the header and no data rows returns an empty list."""
        path = _write_csv([])
        try:
            rows = load_accueil_velo_csv(path)
            assert rows == []
        finally:
            os.unlink(path)

    def test_first_sous_type_is_preserved(self):
        """The first "Sous-type" column value is stored under key "Sous-type"."""
        path = _write_csv([_make_csv_row(sous_type_1="Hébergement", sous_type_2="Locatif")])
        try:
            rows = load_accueil_velo_csv(path)
            assert rows[0]["Sous-type"] == "Hébergement"
        finally:
            os.unlink(path)

    def test_second_sous_type_not_in_dict(self):
        """The second duplicate "Sous-type" column is not stored separately."""
        path = _write_csv([_make_csv_row(sous_type_1="Hébergement", sous_type_2="Locatif")])
        try:
            rows = load_accueil_velo_csv(path)
            # Only one "Sous-type" key should exist; the second is discarded
            assert list(rows[0].keys()).count("Sous-type") == 1
        finally:
            os.unlink(path)

    def test_multiple_rows_loaded(self):
        path = _write_csv([
            _make_csv_row(identifiant="A1"),
            _make_csv_row(identifiant="A2"),
        ])
        try:
            rows = load_accueil_velo_csv(path)
            assert len(rows) == 2
        finally:
            os.unlink(path)

    def test_lat_lon_accessible(self):
        path = _write_csv([_make_csv_row(lat="48.5", lon="2.3")])
        try:
            rows = load_accueil_velo_csv(path)
            assert rows[0]["Latitude"] == "48.5"
            assert rows[0]["Longitude"] == "2.3"
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# TestFilterBySousType
# ---------------------------------------------------------------------------

class TestFilterBySousType:
    def _rows(self, sous_types: list[str]) -> list[dict]:
        return [{"Sous-type": st, "Identifiant": str(i)} for i, st in enumerate(sous_types)]

    def test_exact_match_included(self):
        rows = self._rows(["Hébergement"])
        assert len(filter_by_sous_type(rows, "Hébergement")) == 1

    def test_substring_match_included(self):
        """A keyword that is a substring of the cell value still matches."""
        rows = self._rows(["Hébergement locatif"])
        assert len(filter_by_sous_type(rows, "Hébergement")) == 1

    def test_non_matching_excluded(self):
        rows = self._rows(["Restauration"])
        assert filter_by_sous_type(rows, "Hébergement") == []

    def test_case_insensitive(self):
        rows = self._rows(["hébergement"])
        assert len(filter_by_sous_type(rows, "Hébergement")) == 1

    def test_mixed_rows_filtered_correctly(self):
        rows = self._rows(["Hébergement", "Restauration", "Autre"])
        result = filter_by_sous_type(rows, "Restauration")
        assert len(result) == 1
        assert result[0]["Sous-type"] == "Restauration"

    def test_empty_rows_returns_empty(self):
        assert filter_by_sous_type([], "Hébergement") == []


# ---------------------------------------------------------------------------
# TestExtractFirstUrl
# ---------------------------------------------------------------------------

class TestExtractFirstUrl:
    def test_single_url_returned(self):
        assert _extract_first_url("https://example.com") == "https://example.com"

    def test_first_url_of_multiple_returned(self):
        assert _extract_first_url("https://a.com,https://b.com") == "https://a.com"

    def test_whitespace_around_url_stripped(self):
        assert _extract_first_url(" https://a.com , https://b.com") == "https://a.com"

    def test_empty_string_returns_none(self):
        assert _extract_first_url("") is None

    def test_only_commas_returns_none(self):
        assert _extract_first_url(",,") is None


# ---------------------------------------------------------------------------
# TestRowToFeature
# ---------------------------------------------------------------------------

class TestRowToFeature:
    def _row(self, lat="48.0", lon="2.0", nom="Test", identifiant="ID1", site="https://x.com"):
        return {
            "Latitude": lat,
            "Longitude": lon,
            "Nom": nom,
            "Identifiant": identifiant,
            "Site internet": site,
        }

    def test_valid_row_returns_geojson_feature(self):
        feat = _row_to_feature(self._row())
        assert feat is not None
        assert feat["type"] == "Feature"
        assert feat["geometry"]["type"] == "Point"

    def test_coordinates_are_lon_lat_order(self):
        """GeoJSON uses [lon, lat] coordinate order."""
        feat = _row_to_feature(self._row(lat="48.0", lon="2.5"))
        assert feat["geometry"]["coordinates"] == [2.5, 48.0]

    def test_invalid_lat_returns_none(self):
        assert _row_to_feature(self._row(lat="not_a_number")) is None

    def test_invalid_lon_returns_none(self):
        assert _row_to_feature(self._row(lon="")) is None

    def test_missing_lat_key_returns_none(self):
        row = {"Longitude": "2.0", "Nom": "Test", "Identifiant": "ID1", "Site internet": ""}
        assert _row_to_feature(row) is None

    def test_empty_nom_yields_none_name(self):
        feat = _row_to_feature(self._row(nom=""))
        assert feat["properties"]["name"] is None

    def test_website_extracted(self):
        feat = _row_to_feature(self._row(site="https://example.com"))
        assert feat["properties"]["website"] == "https://example.com"

    def test_empty_website_yields_none(self):
        feat = _row_to_feature(self._row(site=""))
        assert feat["properties"]["website"] is None


# ---------------------------------------------------------------------------
# TestFindAccueilVeloNearRoute
# ---------------------------------------------------------------------------

class TestFindAccueilVeloNearRoute:
    def _track(self):
        return _make_track([(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)])

    def _row(self, lat, lon, identifiant="ID1"):
        return {
            "Latitude": str(lat),
            "Longitude": str(lon),
            "Nom": "Test",
            "Identifiant": identifiant,
            "Site internet": "",
        }

    def test_point_on_route_is_found(self):
        rows = [self._row(49.0, 2.0)]
        result = find_accueil_velo_near_route(self._track(), rows, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].id == "ID1"

    def test_far_point_is_excluded(self):
        rows = [self._row(48.5, 4.0)]
        result = find_accueil_velo_near_route(self._track(), rows, max_distance_km=5.0)
        assert result == []

    def test_invalid_coords_row_is_skipped(self):
        rows = [{"Latitude": "bad", "Longitude": "bad", "Identifiant": "X", "Nom": "", "Site internet": ""}]
        result = find_accueil_velo_near_route(self._track(), rows, max_distance_km=5.0)
        assert result == []

    def test_empty_rows_returns_empty(self):
        result = find_accueil_velo_near_route(self._track(), [], max_distance_km=5.0)
        assert result == []

    def test_returns_accueil_velo_point_instances(self):
        rows = [self._row(49.0, 2.0)]
        result = find_accueil_velo_near_route(self._track(), rows, max_distance_km=5.0)
        assert all(isinstance(p, AccueilVeloPoint) for p in result)

    def test_null_name_preserved_as_none(self):
        row = self._row(49.0, 2.0)
        row["Nom"] = ""
        result = find_accueil_velo_near_route(self._track(), [row], max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].name is None

    def test_distance_to_route_is_non_negative(self):
        rows = [self._row(48.5, 2.0)]
        result = find_accueil_velo_near_route(self._track(), rows, max_distance_km=5.0)
        assert len(result) == 1
        assert result[0].distance_to_route_km >= 0.0


# ---------------------------------------------------------------------------
# TestSerializeAccueilVeloPoints
# ---------------------------------------------------------------------------

class TestSerializeAccueilVeloPoints:
    def test_all_fields_present(self):
        point = AccueilVeloPoint(
            id="ID42",
            name="Gîte du Vélo",
            website="https://example.com",
            lat=48.5,
            lon=2.3,
            distance_to_route_km=1.2,
        )
        result = serialize_accueil_velo_points([point])
        assert len(result) == 1
        d = result[0]
        assert d["id"] == "ID42"
        assert d["name"] == "Gîte du Vélo"
        assert d["website"] == "https://example.com"
        assert d["lat"] == pytest.approx(48.5)
        assert d["lon"] == pytest.approx(2.3)

    def test_null_fields_serialised_as_none(self):
        point = AccueilVeloPoint(
            id="ID99",
            name=None,
            website=None,
            lat=48.0,
            lon=2.0,
            distance_to_route_km=0.5,
        )
        result = serialize_accueil_velo_points([point])
        d = result[0]
        assert d["name"] is None
        assert d["website"] is None

    def test_output_is_json_serializable(self):
        point = AccueilVeloPoint("X", None, None, 47.0, 3.0, 2.1)
        result = serialize_accueil_velo_points([point])
        serialized = json.dumps(result)
        assert "null" in serialized

    def test_empty_list_returns_empty(self):
        assert serialize_accueil_velo_points([]) == []

    def test_multiple_points_all_serialized(self):
        points = [
            AccueilVeloPoint("A", "Name A", None, 48.0, 2.0, 1.0),
            AccueilVeloPoint("B", "Name B", None, 49.0, 2.0, 2.0),
        ]
        result = serialize_accueil_velo_points(points)
        assert len(result) == 2
        assert result[0]["id"] == "A"
        assert result[1]["id"] == "B"
