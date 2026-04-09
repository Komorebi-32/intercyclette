"""
Navitia API HTTP client.

All network I/O for SNCF train journey searches is isolated here.
Authentication token is read from the NAVITIA_TOKEN environment variable.

Navitia docs: https://doc.navitia.io/#getting-started
"""

import os
from dataclasses import dataclass, field
from datetime import datetime, date

import requests

from app.constants import (
    NAVITIA_BASE_URL,
    NAVITIA_DATETIME_FMT,
    NAVITIA_DEFAULT_HOUR,
    NAVITIA_RETURN_HOUR,
    NAVITIA_TIMEOUT_SECONDS,
    OUTBOUND_CANDIDATE_COUNT,
    RETURN_CANDIDATE_COUNT,
)


class NavitiaError(Exception):
    """Raised when a Navitia API call fails (HTTP error, timeout, bad JSON)."""


@dataclass
class NavitiaConfig:
    """
    Navitia API connection configuration.

    Attributes:
        token: API authentication token (used as HTTP Basic username).
        base_url: Base URL for the Navitia API.
    """

    token: str
    base_url: str = NAVITIA_BASE_URL


def load_config_from_env() -> NavitiaConfig:
    """
    Build a NavitiaConfig by reading the NAVITIA_TOKEN environment variable.

    Returns:
        NavitiaConfig populated from the environment.

    Raises:
        RuntimeError: If NAVITIA_TOKEN is not set or is empty.
    """
    token = os.environ.get("NAVITIA_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "NAVITIA_TOKEN environment variable is not set. "
            "Set it to your Navitia API token before starting the app."
        )
    return NavitiaConfig(token=token)


def _format_datetime(travel_date: str, hour: int) -> str:
    """
    Combine a date string and hour integer into a Navitia datetime string.

    Args:
        travel_date: Date in 'YYYYMMDD' format.
        hour: Hour of day (0–23) for the journey.

    Returns:
        Formatted datetime string like '20260409T080000'.
    """
    dt = datetime.strptime(travel_date, "%Y%m%d").replace(hour=hour)
    return dt.strftime(NAVITIA_DATETIME_FMT)


def build_journey_url(
    config: NavitiaConfig,
    from_uic: str,
    to_uic: str,
    datetime_str: str,
) -> str:
    """
    Build the full Navitia journeys endpoint URL for a given pair of stations.

    Args:
        config: NavitiaConfig with base_url.
        from_uic: Departure station UIC code string (e.g. '87313759').
        to_uic: Arrival station UIC code string.
        datetime_str: Departure datetime in NAVITIA_DATETIME_FMT format.

    Returns:
        Complete URL string ready for a GET request.
    """
    from_id = f"stop_area:SNCF:{from_uic}"
    to_id = f"stop_area:SNCF:{to_uic}"
    return (
        f"{config.base_url}/journeys"
        f"?from={from_id}&to={to_id}&datetime={datetime_str}"
    )


def fetch_journey(
    config: NavitiaConfig,
    from_uic: str,
    to_uic: str,
    datetime_str: str,
) -> dict:
    """
    Execute one GET request to the Navitia journeys endpoint.

    Uses HTTP Basic authentication with the token as the username and an
    empty password, as required by the Navitia API.

    Args:
        config: NavitiaConfig with token and base_url.
        from_uic: Departure station UIC code string.
        to_uic: Arrival station UIC code string.
        datetime_str: Departure datetime in NAVITIA_DATETIME_FMT format.

    Returns:
        Parsed JSON response dict from the Navitia API.

    Raises:
        NavitiaError: On HTTP error status, connection timeout, or invalid JSON.
    """
    url = build_journey_url(config, from_uic, to_uic, datetime_str)
    try:
        response = requests.get(
            url,
            auth=(config.token, ""),
            timeout=NAVITIA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.Timeout as exc:
        raise NavitiaError(
            f"Navitia request timed out after {NAVITIA_TIMEOUT_SECONDS}s: {url}"
        ) from exc
    except requests.exceptions.HTTPError as exc:
        raise NavitiaError(
            f"Navitia HTTP error {exc.response.status_code}: {url}"
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise NavitiaError(f"Navitia request failed: {exc}") from exc
    except ValueError as exc:
        raise NavitiaError(f"Navitia returned invalid JSON: {exc}") from exc


def fetch_outbound_journeys(
    config: NavitiaConfig,
    departure_uic: str,
    candidate_uics: list[str],
    travel_date: str,
) -> list[dict]:
    """
    Fetch train journeys from the departure city to each of the candidate
    route-start stations (outbound leg).

    Makes exactly len(candidate_uics) API calls (≤ OUTBOUND_CANDIDATE_COUNT).
    Stations for which the API call raises NavitiaError are recorded as None
    in the returned list, so the caller can identify failed lookups.

    Args:
        config: NavitiaConfig.
        departure_uic: UIC code of the user's home station.
        candidate_uics: UIC codes of route-start candidate stations.
                        Typically 3 (OUTBOUND_CANDIDATE_COUNT).
        travel_date: Date in 'YYYYMMDD' format.

    Returns:
        List of dicts, one per candidate UIC. Each entry is the raw Navitia
        response dict, or None if the call failed.
    """
    datetime_str = _format_datetime(travel_date, NAVITIA_DEFAULT_HOUR)
    results: list[dict | None] = []
    for uic in candidate_uics[:OUTBOUND_CANDIDATE_COUNT]:
        try:
            results.append(fetch_journey(config, departure_uic, uic, datetime_str))
        except NavitiaError:
            results.append(None)
    return results


def fetch_return_journeys(
    config: NavitiaConfig,
    return_uics: list[str],
    departure_uic: str,
    travel_date: str,
) -> list[dict]:
    """
    Fetch train journeys from each of the route-end candidate stations back
    to the departure city (return leg).

    Makes exactly len(return_uics) API calls (≤ RETURN_CANDIDATE_COUNT).
    Failed calls are recorded as None.

    Args:
        config: NavitiaConfig.
        return_uics: UIC codes of route-end candidate stations.
                     Typically 3 (RETURN_CANDIDATE_COUNT).
        departure_uic: UIC code of the user's home station.
        travel_date: Date in 'YYYYMMDD' format.

    Returns:
        List of dicts, one per return UIC. Each entry is the raw Navitia
        response dict, or None if the call failed.
    """
    datetime_str = _format_datetime(travel_date, NAVITIA_RETURN_HOUR)
    results: list[dict | None] = []
    for uic in return_uics[:RETURN_CANDIDATE_COUNT]:
        try:
            results.append(fetch_journey(config, uic, departure_uic, datetime_str))
        except NavitiaError:
            results.append(None)
    return results
