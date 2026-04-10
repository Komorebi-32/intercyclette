"""
Tests for scripts/build_gtfs_index.py.

Uses a small synthetic GTFS fixture in tests/fixtures/gtfs/ with:
  - 3 French stations (UIC 87001000, 87002000, 87003000)
  - 1 non-French station (UIC 71001000) — must be excluded
  - TER, Intercités, TGV Inoui, and Ouigo stops
  - 2 TER trips, 2 Intercités trips, 1 single-stop (short) trip
  - 3 service IDs with varying date sets

stations.geojson fixture for alias tests:
  - 87001000 (Lyon Part-Dieu)   — exact match in GTFS → no alias
  - 87003999 (Avignon)          — GTFS has 87003000 → alias 87003999 → 87003000
  - 87547026 (Paris Austerlitz) — name not in fixture GTFS → no alias
  - 87999999 (Station inconnue) — no name match → no alias
"""

import os
import sys
import pytest

# Allow importing the script under test
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.build_gtfs_index import (
    _normalize_name,
    build_uic_aliases,
    load_gtfs_stop_names,
    build_compact_index,
    build_trip_stops,
    extract_train_type,
    extract_uic_from_stop_id,
    load_filtered_stops,
    load_service_dates,
    load_trip_service_map,
    parse_time_to_minutes,
)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "gtfs")


# ---------------------------------------------------------------------------
# extract_train_type
# ---------------------------------------------------------------------------


def test_extract_train_type_ter():
    """extract_train_type returns 'TER' for a TER stop ID."""
    assert extract_train_type("StopPoint:OCETrain TER-87001000") == "TER"


def test_extract_train_type_intercites():
    """extract_train_type returns 'INTERCITES' for an Intercités stop ID."""
    assert extract_train_type("StopPoint:OCEINTERCITES-87001000") == "INTERCITES"


def test_extract_train_type_invalid_raises():
    """extract_train_type raises ValueError for an unrecognised prefix."""
    with pytest.raises(ValueError, match="Unrecognised"):
        extract_train_type("StopPoint:OCETGV INOUI-87001000")


# ---------------------------------------------------------------------------
# extract_uic_from_stop_id
# ---------------------------------------------------------------------------


def test_extract_uic_from_ter_stop_id():
    """UIC is correctly extracted from a TER stop ID."""
    assert extract_uic_from_stop_id("StopPoint:OCETrain TER-87001000") == "87001000"


def test_extract_uic_from_intercites_stop_id():
    """UIC is correctly extracted from an Intercités stop ID."""
    assert extract_uic_from_stop_id("StopPoint:OCEINTERCITES-87003000") == "87003000"


# ---------------------------------------------------------------------------
# load_filtered_stops
# ---------------------------------------------------------------------------


def test_load_filtered_stops_keeps_ter_and_intercites():
    """load_filtered_stops retains TER and Intercités stops."""
    result = load_filtered_stops(FIXTURES_DIR)
    assert "StopPoint:OCETrain TER-87001000" in result
    assert "StopPoint:OCEINTERCITES-87001000" in result
    assert "StopPoint:OCETrain TER-87002000" in result
    assert "StopPoint:OCEINTERCITES-87003000" in result


def test_load_filtered_stops_excludes_tgv_and_ouigo():
    """load_filtered_stops excludes TGV Inoui and Ouigo stops."""
    result = load_filtered_stops(FIXTURES_DIR)
    assert "StopPoint:OCETGV INOUI-87003000" not in result
    assert "StopPoint:OCEOUIGO-87003000" not in result


def test_load_filtered_stops_excludes_non_french_uic():
    """load_filtered_stops excludes stops with non-87 UIC prefix (international)."""
    result = load_filtered_stops(FIXTURES_DIR)
    # 71001000 does not start with '87', so should not be present regardless of type
    uics = set(result.values())
    assert "71001000" not in uics


def test_load_filtered_stops_uic_values():
    """load_filtered_stops maps stop IDs to their correct UIC strings."""
    result = load_filtered_stops(FIXTURES_DIR)
    assert result["StopPoint:OCETrain TER-87001000"] == "87001000"
    assert result["StopPoint:OCEINTERCITES-87003000"] == "87003000"


# ---------------------------------------------------------------------------
# parse_time_to_minutes
# ---------------------------------------------------------------------------


def test_parse_time_to_minutes_standard():
    """parse_time_to_minutes converts '08:00:00' to 480."""
    assert parse_time_to_minutes("08:00:00") == 480


def test_parse_time_to_minutes_midnight():
    """parse_time_to_minutes converts '00:00:00' to 0."""
    assert parse_time_to_minutes("00:00:00") == 0


def test_parse_time_to_minutes_end_of_day():
    """parse_time_to_minutes converts '23:59:00' to 1439."""
    assert parse_time_to_minutes("23:59:00") == 1439


def test_parse_time_to_minutes_overnight():
    """parse_time_to_minutes handles times beyond 24:00 without raising."""
    result = parse_time_to_minutes("25:30:00")
    assert result == 25 * 60 + 30


def test_parse_time_to_minutes_invalid_format():
    """parse_time_to_minutes raises ValueError for malformed input."""
    with pytest.raises((ValueError, IndexError)):
        parse_time_to_minutes("8h00")


# ---------------------------------------------------------------------------
# load_trip_service_map
# ---------------------------------------------------------------------------


def test_load_trip_service_map_returns_all_trips():
    """load_trip_service_map returns an entry for every trip in trips.txt."""
    result = load_trip_service_map(FIXTURES_DIR)
    assert result["TRIP_TER_001"] == "SVC001"
    assert result["TRIP_TER_002"] == "SVC002"
    assert result["TRIP_IC_001"] == "SVC001"
    assert result["TRIP_IC_002"] == "SVC003"
    assert result["TRIP_SHORT"] == "SVC001"


# ---------------------------------------------------------------------------
# build_trip_stops
# ---------------------------------------------------------------------------


def test_build_trip_stops_orders_by_sequence():
    """build_trip_stops returns stops sorted by stop_sequence ascending."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    stops = result["TRIP_TER_001"]
    uics = [uic for uic, _ in stops]
    assert uics == [87001000, 87002000]


def test_build_trip_stops_correct_departure_minutes():
    """build_trip_stops converts departure times to integer minutes."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    _, dep_first = result["TRIP_TER_001"][0]
    assert dep_first == 480  # 08:00

    _, dep_second = result["TRIP_TER_001"][1]
    assert dep_second == 540  # 09:00


def test_build_trip_stops_filters_short_trips():
    """build_trip_stops excludes trips with fewer than GTFS_MIN_STOPS_PER_TRIP stops."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    assert "TRIP_SHORT" not in result


def test_build_trip_stops_includes_intercites():
    """build_trip_stops includes Intercités trips alongside TER trips."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    assert "TRIP_IC_001" in result
    uics = [uic for uic, _ in result["TRIP_IC_001"]]
    assert uics == [87001000, 87003000]


# ---------------------------------------------------------------------------
# load_service_dates
# ---------------------------------------------------------------------------


def test_load_service_dates_keeps_active_only():
    """load_service_dates only includes exception_type 1 (active) dates."""
    trip_service_map = load_trip_service_map(FIXTURES_DIR)
    valid_ids = set(trip_service_map.values())
    result = load_service_dates(FIXTURES_DIR, valid_ids)
    # SVC002 date 20260502 has exception_type 2 (removed) — must not appear
    assert 20260502 not in result.get("SVC002", [])
    assert 20260501 in result.get("SVC002", [])


def test_load_service_dates_excludes_unknown_service():
    """load_service_dates ignores service IDs not in valid_service_ids."""
    result = load_service_dates(FIXTURES_DIR, {"SVC001"})
    assert "SVC002" not in result
    assert "SVC003" not in result


def test_load_service_dates_sorted():
    """load_service_dates returns date lists sorted in ascending order."""
    trip_service_map = load_trip_service_map(FIXTURES_DIR)
    valid_ids = set(trip_service_map.values())
    result = load_service_dates(FIXTURES_DIR, valid_ids)
    dates = result.get("SVC001", [])
    assert dates == sorted(dates)


# ---------------------------------------------------------------------------
# build_compact_index
# ---------------------------------------------------------------------------


def _build_full_index():
    """Helper: run all parse steps and assemble the compact index."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    trip_service_map = load_trip_service_map(FIXTURES_DIR)
    trip_stops = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    valid_service_ids = {
        trip_service_map[tid]
        for tid in trip_stops
        if tid in trip_service_map
    }
    service_dates = load_service_dates(FIXTURES_DIR, valid_service_ids)
    return build_compact_index(trip_stops, trip_service_map, service_dates, stop_to_uic)


def test_build_compact_index_remaps_service_ids():
    """build_compact_index replaces long service IDs with short integer string keys."""
    index = _build_full_index()
    svc_keys = set(index["services"].keys())
    # Keys must all be numeric strings
    assert all(k.isdigit() for k in svc_keys)


def test_build_compact_index_skips_trips_without_dates():
    """build_compact_index omits trips whose service ID has no calendar entries."""
    # TRIP_IC_002 is on SVC003 which has only date 20260601 — still included,
    # but if we pass empty service_dates it must be dropped.
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    trip_service_map = load_trip_service_map(FIXTURES_DIR)
    trip_stops = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    # Pass empty service_dates so every trip is skipped
    index = build_compact_index(trip_stops, trip_service_map, {}, stop_to_uic)
    assert len(index["trips"]) == 0


def test_build_compact_index_train_type_codes():
    """build_compact_index assigns type 0 to TER and type 1 to Intercités trips."""
    index = _build_full_index()
    train_types = index["train_types"]
    for trip in index["trips"]:
        assert trip["type"] in (0, 1)
        assert train_types[trip["type"]] in ("TER", "INTERCITES")


def test_build_compact_index_has_date_range():
    """build_compact_index populates date_range with min and max YYYYMMDD integers."""
    index = _build_full_index()
    dr = index["date_range"]
    assert dr is not None
    assert dr["min"] <= dr["max"]


def test_build_compact_index_stops_shape():
    """Each trip in the index has stops as [[uic_int, dep_minutes], ...] pairs."""
    index = _build_full_index()
    for trip in index["trips"]:
        for stop in trip["stops"]:
            assert len(stop) == 2
            uic, dep = stop
            assert isinstance(uic, int)
            assert isinstance(dep, int)
            assert dep >= 0


# ---------------------------------------------------------------------------
# _normalize_name
# ---------------------------------------------------------------------------

GEOJSON_PATH = os.path.join(FIXTURES_DIR, "stations.geojson")


def test_normalize_name_strips_accents():
    """_normalize_name converts accented characters to their base form."""
    assert _normalize_name("Orléans") == "orleans"


def test_normalize_name_lowercases():
    """_normalize_name lowercases all characters."""
    assert _normalize_name("Paris Austerlitz") == "paris austerlitz"


def test_normalize_name_idempotent():
    """_normalize_name is idempotent — calling it twice returns the same result."""
    name = "Évreux"
    assert _normalize_name(_normalize_name(name)) == _normalize_name(name)


# ---------------------------------------------------------------------------
# load_gtfs_stop_names
# ---------------------------------------------------------------------------


def test_load_gtfs_stop_names_includes_ter_stops():
    """load_gtfs_stop_names returns entries for TER stops."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    assert "lyon part-dieu" in result


def test_load_gtfs_stop_names_excludes_non_ter_stops():
    """load_gtfs_stop_names excludes stops not in stop_to_uic (TGV, Ouigo, etc.)."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    # "barcelone-sants" only has a TGV stop in the fixture — not in stop_to_uic
    assert "barcelone-sants" not in result


def test_load_gtfs_stop_names_maps_to_uic():
    """load_gtfs_stop_names maps normalised name to a UIC string."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    result = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    assert result.get("lyon part-dieu") == "87001000"


# ---------------------------------------------------------------------------
# build_uic_aliases
# ---------------------------------------------------------------------------


def test_build_uic_aliases_detects_name_match():
    """build_uic_aliases creates an alias when geojson and GTFS UICs differ but names match."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    gtfs_name_to_uic = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    result = build_uic_aliases(GEOJSON_PATH, stop_to_uic, gtfs_name_to_uic)
    # Fixture: geojson has Avignon=87003999, GTFS has Avignon=87003000
    assert result.get("87003999") == "87003000"


def test_build_uic_aliases_no_alias_when_uic_matches():
    """build_uic_aliases omits stations whose geojson UIC already exists in GTFS."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    gtfs_name_to_uic = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    result = build_uic_aliases(GEOJSON_PATH, stop_to_uic, gtfs_name_to_uic)
    # Lyon Part-Dieu UIC 87001000 matches directly — no alias needed
    assert "87001000" not in result


def test_build_uic_aliases_no_alias_when_name_not_found():
    """build_uic_aliases omits geojson stations whose name has no GTFS TER/IC match."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    gtfs_name_to_uic = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    result = build_uic_aliases(GEOJSON_PATH, stop_to_uic, gtfs_name_to_uic)
    # "Station inconnue" (87999999) has no counterpart in GTFS fixture
    assert "87999999" not in result


def test_build_compact_index_embeds_aliases():
    """build_compact_index includes uic_aliases in the output dict."""
    stop_to_uic = load_filtered_stops(FIXTURES_DIR)
    gtfs_name_to_uic = load_gtfs_stop_names(FIXTURES_DIR, stop_to_uic)
    aliases = build_uic_aliases(GEOJSON_PATH, stop_to_uic, gtfs_name_to_uic)
    trip_service_map = load_trip_service_map(FIXTURES_DIR)
    trip_stops = build_trip_stops(FIXTURES_DIR, stop_to_uic)
    valid_service_ids = {trip_service_map[tid] for tid in trip_stops if tid in trip_service_map}
    service_dates = load_service_dates(FIXTURES_DIR, valid_service_ids)
    index = build_compact_index(trip_stops, trip_service_map, service_dates, stop_to_uic, aliases)
    assert "uic_aliases" in index
    assert index["uic_aliases"] == aliases
