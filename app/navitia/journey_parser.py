"""
Navitia API response parser.

Extracts structured journey data from raw Navitia JSON responses.
No I/O or network calls — safe to use in any context.
"""

from dataclasses import dataclass, field


@dataclass
class JourneyResult:
    """
    A structured representation of one train journey from Navitia.

    Attributes:
        from_station_nom: Name of the departure station.
        to_station_nom: Name of the arrival station.
        departure_datetime: ISO 8601 departure datetime string (e.g. '2026-04-09T08:04:00').
        arrival_datetime: ISO 8601 arrival datetime string.
        duration_minutes: Total journey duration in minutes.
        nb_transfers: Number of transfers in the journey.
        sections: List of simplified section summaries (mode, from, to, duration_min).
    """

    from_station_nom: str
    to_station_nom: str
    departure_datetime: str
    arrival_datetime: str
    duration_minutes: int
    nb_transfers: int
    sections: list[dict] = field(default_factory=list)


def _navitia_datetime_to_iso(navitia_dt: str) -> str:
    """
    Convert a Navitia datetime string to ISO 8601 format.

    Navitia uses the format '20260409T080400' (no separators).
    ISO 8601 format is '2026-04-09T08:04:00'.

    Args:
        navitia_dt: Datetime string in Navitia format 'YYYYMMDDTHHmmss'.

    Returns:
        ISO 8601 string, or the original string if it cannot be parsed.
    """
    try:
        date_part = navitia_dt[:8]
        time_part = navitia_dt[9:15] if len(navitia_dt) >= 15 else navitia_dt[9:]
        year = date_part[:4]
        month = date_part[4:6]
        day = date_part[6:8]
        hour = time_part[:2]
        minute = time_part[2:4]
        second = time_part[4:6] if len(time_part) >= 6 else "00"
        return f"{year}-{month}-{day}T{hour}:{minute}:{second}"
    except (IndexError, ValueError):
        return navitia_dt


def _extract_station_name(place: dict) -> str:
    """
    Extract a human-readable station name from a Navitia 'place' dict.

    Args:
        place: A Navitia place object (from journey 'from' or 'to' fields,
               or section endpoint).

    Returns:
        Station name string. Returns empty string if the structure is unexpected.
    """
    stop_area = place.get("stop_area") or place.get("stop_point", {})
    if stop_area:
        return stop_area.get("name", "")
    return place.get("name", "")


def parse_journey_sections(journey: dict) -> list[dict]:
    """
    Extract simplified section summaries from a single Navitia journey dict.

    Each section is simplified to: mode, from station name, to station name,
    and duration in minutes.

    Args:
        journey: A single journey object from a Navitia API response.

    Returns:
        List of dicts with keys 'mode', 'from', 'to', 'duration_min'.
        Empty list if no sections are present.
    """
    sections = []
    for section in journey.get("sections", []):
        section_type = section.get("type", "")
        mode = section.get("display_informations", {}).get("physical_mode", section_type)
        from_place = _extract_station_name(section.get("from", {}))
        to_place = _extract_station_name(section.get("to", {}))
        duration_sec = section.get("duration", 0)
        sections.append({
            "mode": mode,
            "from": from_place,
            "to": to_place,
            "duration_min": round(duration_sec / 60),
        })
    return sections


def parse_best_journey(api_response: dict) -> JourneyResult | None:
    """
    Extract the best (first) journey from a Navitia journeys API response.

    Navitia returns journeys sorted by optimality (fastest / fewest transfers).
    This function takes the first journey in the list as the recommended option.

    Args:
        api_response: Parsed JSON dict from a Navitia /journeys endpoint call.

    Returns:
        JourneyResult for the first journey, or None if:
        - The response contains no journeys.
        - The 'journeys' key is missing.

    Raises:
        ValueError: If the response structure is unexpectedly malformed (missing
                    required fields on a journey that does exist).
    """
    journeys = api_response.get("journeys")
    if not journeys:
        return None

    journey = journeys[0]

    try:
        departure_dt = _navitia_datetime_to_iso(journey["departure_date_time"])
        arrival_dt = _navitia_datetime_to_iso(journey["arrival_date_time"])
        duration_sec = journey["duration"]
        nb_transfers = journey.get("nb_transfers", 0)
    except KeyError as exc:
        raise ValueError(f"Journey missing required field: {exc}") from exc

    from_nom = _extract_station_name(journey.get("sections", [{}])[0].get("from", {}))
    to_nom = _extract_station_name(
        journey.get("sections", [{}])[-1].get("to", {})
        if journey.get("sections")
        else {}
    )
    sections = parse_journey_sections(journey)

    return JourneyResult(
        from_station_nom=from_nom,
        to_station_nom=to_nom,
        departure_datetime=departure_dt,
        arrival_datetime=arrival_dt,
        duration_minutes=round(duration_sec / 60),
        nb_transfers=nb_transfers,
        sections=sections,
    )


def format_duration_minutes(total_minutes: int) -> str:
    """
    Convert a duration in minutes to a human-readable French-style string.

    Args:
        total_minutes: Non-negative integer number of minutes.

    Returns:
        Formatted string like '1h 35min' or '45min' (if under 1 hour)
        or '2h' (if exactly on the hour).

    Raises:
        ValueError: If total_minutes is negative.
    """
    if total_minutes < 0:
        raise ValueError(f"total_minutes must be non-negative, got {total_minutes}")
    hours = total_minutes // 60
    minutes = total_minutes % 60
    if hours == 0:
        return f"{minutes}min"
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}min"
