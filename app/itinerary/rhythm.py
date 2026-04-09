"""
Biking rhythm computation.

Translates a rhythm key (slow / normal / fast) into daily distance figures
and total trip distance based on the number of days available.
"""

from dataclasses import dataclass

from app.constants import RHYTHMS, MIN_DAYS, MAX_DAYS, HALF_DAY_FRACTION


@dataclass
class Rhythm:
    """
    A biking rhythm profile.

    Attributes:
        key: Identifier string matching a key in RHYTHMS (e.g. 'randonneur').
        label: Human-readable French label for the UI.
        speed_kmh: Average cycling speed in km/h.
        hours_per_day: Number of hours cycled on a full biking day.
    """

    key: str
    label: str
    speed_kmh: float
    hours_per_day: float


def get_rhythm(rhythm_key: str) -> Rhythm:
    """
    Return the Rhythm dataclass for a given key.

    Args:
        rhythm_key: One of the keys defined in RHYTHMS constant
                    ('escargot', 'randonneur', 'athlete').

    Returns:
        Rhythm dataclass populated from RHYTHMS.

    Raises:
        ValueError: If rhythm_key is not a valid key in RHYTHMS.
    """
    if rhythm_key not in RHYTHMS:
        valid = list(RHYTHMS.keys())
        raise ValueError(
            f"Unknown rhythm key '{rhythm_key}'. Valid keys: {valid}"
        )
    data = RHYTHMS[rhythm_key]
    return Rhythm(
        key=rhythm_key,
        label=data["label"],
        speed_kmh=data["speed_kmh"],
        hours_per_day=data["hours_per_day"],
    )


def km_per_full_day(rhythm: Rhythm) -> float:
    """
    Return the maximum distance bikeable in one full day for a given rhythm.

    Args:
        rhythm: Rhythm dataclass describing the cyclist's pace.

    Returns:
        Distance in km as a positive float (speed_kmh × hours_per_day).
    """
    return rhythm.speed_kmh * rhythm.hours_per_day


def total_biking_km(n_days: int, rhythm: Rhythm) -> float:
    """
    Compute the total biking distance for a trip of n_days.

    Day 1 and the last day each lose half a day to train travel, so the
    combined train overhead equals one full biking day.

    - For n_days == 1: one half-day of biking (HALF_DAY_FRACTION × km/day).
    - For n_days >= 2: (n_days - 1) × km_per_full_day, accounting for the
      half-day lost at each end of the trip.

    Args:
        n_days: Total number of days available for the trip, including travel.
                Must be in [MIN_DAYS, MAX_DAYS].
        rhythm: Rhythm dataclass describing the cyclist's pace.

    Returns:
        Total biking distance in km as a positive float.

    Raises:
        ValueError: If n_days is outside [MIN_DAYS, MAX_DAYS].
    """
    if n_days < MIN_DAYS or n_days > MAX_DAYS:
        raise ValueError(
            f"n_days must be between {MIN_DAYS} and {MAX_DAYS}, got {n_days}"
        )
    daily_km = km_per_full_day(rhythm)
    if n_days == 1:
        return HALF_DAY_FRACTION * daily_km
    return (n_days - 1) * daily_km
