"""
Unit tests for app.navitia.journey_parser.
"""

import pytest
from app.navitia.journey_parser import (
    parse_best_journey,
    parse_journey_sections,
    format_duration_minutes,
    JourneyResult,
    _navitia_datetime_to_iso,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_journey(
    departure_dt: str = "20260409T081500",
    arrival_dt: str = "20260409T103000",
    duration_sec: int = 5700,
    nb_transfers: int = 1,
    sections: list[dict] | None = None,
) -> dict:
    """Build a minimal Navitia journey dict."""
    if sections is None:
        sections = [
            {
                "type": "public_transport",
                "from": {"stop_area": {"name": "Paris Gare de Lyon"}},
                "to": {"stop_area": {"name": "Dijon-Ville"}},
                "duration": 5700,
                "display_informations": {"physical_mode": "Train régional"},
            }
        ]
    return {
        "departure_date_time": departure_dt,
        "arrival_date_time": arrival_dt,
        "duration": duration_sec,
        "nb_transfers": nb_transfers,
        "sections": sections,
    }


def _make_response(journeys: list[dict]) -> dict:
    return {"journeys": journeys}


# ---------------------------------------------------------------------------
# _navitia_datetime_to_iso
# ---------------------------------------------------------------------------

class TestNavitiaDatetimeToIso:
    def test_standard_format(self):
        assert _navitia_datetime_to_iso("20260409T081500") == "2026-04-09T08:15:00"

    def test_midnight(self):
        assert _navitia_datetime_to_iso("20260101T000000") == "2026-01-01T00:00:00"

    def test_invalid_returns_string(self):
        """Invalid input returns some string without raising an exception."""
        result = _navitia_datetime_to_iso("INVALID")
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# parse_journey_sections
# ---------------------------------------------------------------------------

class TestParseJourneySections:
    def test_returns_list_of_dicts(self):
        journey = _make_journey()
        result = parse_journey_sections(journey)
        assert isinstance(result, list)
        assert all(isinstance(s, dict) for s in result)

    def test_section_has_required_keys(self):
        journey = _make_journey()
        result = parse_journey_sections(journey)
        assert len(result) >= 1
        section = result[0]
        assert "mode" in section
        assert "from" in section
        assert "to" in section
        assert "duration_min" in section

    def test_duration_converted_to_minutes(self):
        journey = _make_journey(sections=[{
            "type": "public_transport",
            "from": {"stop_area": {"name": "A"}},
            "to": {"stop_area": {"name": "B"}},
            "duration": 3600,
            "display_informations": {"physical_mode": "TER"},
        }])
        result = parse_journey_sections(journey)
        assert result[0]["duration_min"] == 60

    def test_station_names_extracted(self):
        journey = _make_journey()
        result = parse_journey_sections(journey)
        assert "Paris" in result[0]["from"] or result[0]["from"] != ""

    def test_no_sections_returns_empty(self):
        journey = {"departure_date_time": "20260409T080000",
                   "arrival_date_time": "20260409T100000",
                   "duration": 7200, "nb_transfers": 0}
        result = parse_journey_sections(journey)
        assert result == []


# ---------------------------------------------------------------------------
# parse_best_journey
# ---------------------------------------------------------------------------

class TestParseBestJourney:
    def test_returns_journey_result(self):
        response = _make_response([_make_journey()])
        result = parse_best_journey(response)
        assert isinstance(result, JourneyResult)

    def test_returns_none_when_no_journeys(self):
        assert parse_best_journey({"journeys": []}) is None

    def test_returns_none_when_journeys_key_absent(self):
        assert parse_best_journey({}) is None

    def test_duration_in_minutes(self):
        response = _make_response([_make_journey(duration_sec=5700)])
        result = parse_best_journey(response)
        assert result.duration_minutes == 95

    def test_nb_transfers_stored(self):
        response = _make_response([_make_journey(nb_transfers=2)])
        result = parse_best_journey(response)
        assert result.nb_transfers == 2

    def test_departure_datetime_formatted(self):
        response = _make_response([_make_journey(departure_dt="20260409T081500")])
        result = parse_best_journey(response)
        assert result.departure_datetime == "2026-04-09T08:15:00"

    def test_arrival_datetime_formatted(self):
        response = _make_response([_make_journey(arrival_dt="20260409T103000")])
        result = parse_best_journey(response)
        assert result.arrival_datetime == "2026-04-09T10:30:00"

    def test_missing_required_field_raises(self):
        bad_journey = {"nb_transfers": 0}  # Missing departure_date_time etc.
        with pytest.raises(ValueError):
            parse_best_journey({"journeys": [bad_journey]})

    def test_takes_first_journey(self):
        """When multiple journeys returned, picks the first one."""
        j1 = _make_journey(duration_sec=3600)
        j2 = _make_journey(duration_sec=7200)
        response = _make_response([j1, j2])
        result = parse_best_journey(response)
        assert result.duration_minutes == 60


# ---------------------------------------------------------------------------
# format_duration_minutes
# ---------------------------------------------------------------------------

class TestFormatDurationMinutes:
    def test_zero_minutes(self):
        assert format_duration_minutes(0) == "0min"

    def test_under_one_hour(self):
        assert format_duration_minutes(45) == "45min"

    def test_exactly_one_hour(self):
        assert format_duration_minutes(60) == "1h"

    def test_hours_and_minutes(self):
        assert format_duration_minutes(95) == "1h 35min"

    def test_two_hours_exactly(self):
        assert format_duration_minutes(120) == "2h"

    def test_large_duration(self):
        assert format_duration_minutes(300) == "5h"

    def test_negative_raises(self):
        with pytest.raises(ValueError):
            format_duration_minutes(-1)

    def test_one_minute(self):
        assert format_duration_minutes(1) == "1min"
