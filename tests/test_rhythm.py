"""
Unit tests for app.itinerary.rhythm.
"""

import pytest
from app.itinerary.rhythm import get_rhythm, km_per_full_day, total_biking_km, Rhythm
from app.constants import RHYTHMS, MIN_DAYS, MAX_DAYS


class TestGetRhythm:
    def test_returns_rhythm_dataclass(self):
        result = get_rhythm("escargot")
        assert isinstance(result, Rhythm)

    def test_key_stored_on_rhythm(self):
        assert get_rhythm("randonneur").key == "randonneur"

    def test_all_valid_keys_accepted(self):
        for key in RHYTHMS:
            r = get_rhythm(key)
            assert r.key == key

    def test_label_matches_constant(self):
        r = get_rhythm("athlete")
        assert r.label == RHYTHMS["athlete"]["label"]

    def test_speed_matches_constant(self):
        r = get_rhythm("escargot")
        assert r.speed_kmh == RHYTHMS["escargot"]["speed_kmh"]

    def test_hours_matches_constant(self):
        r = get_rhythm("randonneur")
        assert r.hours_per_day == RHYTHMS["randonneur"]["hours_per_day"]

    def test_invalid_key_raises(self):
        with pytest.raises(ValueError, match="Unknown rhythm key"):
            get_rhythm("turbo")

    def test_empty_key_raises(self):
        with pytest.raises(ValueError):
            get_rhythm("")


class TestKmPerFullDay:
    def test_escargot_returns_60(self):
        """12 km/h × 5 h = 60 km/day."""
        r = get_rhythm("escargot")
        assert km_per_full_day(r) == pytest.approx(60.0)

    def test_randonneur_returns_97_5(self):
        """15 km/h × 6.5 h = 97.5 km/day."""
        r = get_rhythm("randonneur")
        assert km_per_full_day(r) == pytest.approx(97.5)

    def test_athlete_returns_160(self):
        """20 km/h × 8 h = 160 km/day."""
        r = get_rhythm("athlete")
        assert km_per_full_day(r) == pytest.approx(160.0)

    def test_returns_positive(self):
        for key in RHYTHMS:
            assert km_per_full_day(get_rhythm(key)) > 0.0


class TestTotalBikingKm:
    def test_one_day_returns_half_day(self):
        """1-day trip: 0.5 × km_per_full_day."""
        r = get_rhythm("escargot")
        assert total_biking_km(1, r) == pytest.approx(0.5 * 60.0)

    def test_two_days_returns_one_full_day(self):
        """2-day trip: (2-1) × 60 = 60 km."""
        r = get_rhythm("escargot")
        assert total_biking_km(2, r) == pytest.approx(60.0)

    def test_three_days_escargot(self):
        """3 days escargot: (3-1) × 60 = 120 km."""
        r = get_rhythm("escargot")
        assert total_biking_km(3, r) == pytest.approx(120.0)

    def test_five_days_randonneur(self):
        """5 days randonneur: (5-1) × 97.5 = 390 km."""
        r = get_rhythm("randonneur")
        assert total_biking_km(5, r) == pytest.approx(390.0)

    def test_max_days_athlete(self):
        """15 days athlete: (15-1) × 160 = 2240 km."""
        r = get_rhythm("athlete")
        assert total_biking_km(15, r) == pytest.approx(2240.0)

    def test_returns_positive_for_all_rhythms_and_min_days(self):
        for key in RHYTHMS:
            assert total_biking_km(MIN_DAYS, get_rhythm(key)) > 0.0

    def test_zero_days_raises(self):
        with pytest.raises(ValueError):
            total_biking_km(0, get_rhythm("escargot"))

    def test_negative_days_raises(self):
        with pytest.raises(ValueError):
            total_biking_km(-1, get_rhythm("escargot"))

    def test_exceeds_max_days_raises(self):
        with pytest.raises(ValueError):
            total_biking_km(MAX_DAYS + 1, get_rhythm("escargot"))

    def test_result_increases_with_days(self):
        """More days always yields more km."""
        r = get_rhythm("randonneur")
        for d in range(MIN_DAYS, MAX_DAYS):
            assert total_biking_km(d + 1, r) > total_biking_km(d, r)
