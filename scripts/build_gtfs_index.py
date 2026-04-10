"""
build_gtfs_index.py — Build a compact timetable index from SNCF GTFS data.

Reads the raw GTFS files (stops.txt, stop_times.txt, trips.txt,
calendar_dates.txt) from GTFS_DIR, filters to TER-train and Intercités
services in France only, and writes a compact JSON index to GTFS_OUTPUT.

The output is consumed at runtime by static/js/timetable.js for in-browser
journey lookups — no proxy, no API key required.

Usage:
    python3 scripts/build_gtfs_index.py
"""

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

# Allow running as a script from the project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.constants import (
    GTFS_DIR,
    GTFS_INTERCITES_STOP_PREFIX,
    GTFS_MIN_STOPS_PER_TRIP,
    GTFS_OUTPUT,
    GTFS_TER_STOP_PREFIX,
)

# Integer codes stored in the timetable for each train type.
_TRAIN_TYPE_CODE = {"TER": 0, "INTERCITES": 1}
_TRAIN_TYPE_NAMES = list(_TRAIN_TYPE_CODE.keys())  # index → name


# ---------------------------------------------------------------------------
# Step 1 — stops.txt
# ---------------------------------------------------------------------------


def extract_train_type(stop_id: str) -> str:
    """
    Determine the train type for a stop based on its stop_id prefix.

    Args:
        stop_id: A GTFS stop ID string (e.g. 'StopPoint:OCETrain TER-87723197').

    Returns:
        'TER' or 'INTERCITES'.

    Raises:
        ValueError: If stop_id does not match any known prefix.
    """
    if stop_id.startswith(GTFS_TER_STOP_PREFIX):
        return "TER"
    if stop_id.startswith(GTFS_INTERCITES_STOP_PREFIX):
        return "INTERCITES"
    raise ValueError(f"Unrecognised stop_id prefix: {stop_id!r}")


def extract_uic_from_stop_id(stop_id: str) -> str:
    """
    Extract the 8-digit UIC station code from a filtered stop_id.

    The UIC is the numeric suffix after the last '-' separator.
    Example: 'StopPoint:OCETrain TER-87723197' → '87723197'.

    Args:
        stop_id: A GTFS stop ID matching one of the known TER or Intercités
                 prefixes.

    Returns:
        8-character UIC string.
    """
    return stop_id.rsplit("-", 1)[-1]


def load_filtered_stops(gtfs_dir: str) -> dict[str, str]:
    """
    Load and filter stops to French TER-train and Intercités stops only.

    Reads stops.txt from gtfs_dir. Keeps rows whose stop_id starts with
    GTFS_TER_STOP_PREFIX or GTFS_INTERCITES_STOP_PREFIX (both imply a
    French UIC '87' prefix by construction of the constant).

    Args:
        gtfs_dir: Path to the directory containing GTFS text files.

    Returns:
        Dict mapping stop_id → uic_string for all qualifying stops.
    """
    path = os.path.join(gtfs_dir, "stops.txt")
    stop_to_uic: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            sid = row["stop_id"].strip()
            if sid.startswith(GTFS_TER_STOP_PREFIX) or sid.startswith(
                GTFS_INTERCITES_STOP_PREFIX
            ):
                stop_to_uic[sid] = extract_uic_from_stop_id(sid)
    return stop_to_uic


# ---------------------------------------------------------------------------
# Step 2 — trips.txt
# ---------------------------------------------------------------------------


def load_trip_service_map(gtfs_dir: str) -> dict[str, str]:
    """
    Load the mapping from trip_id to service_id.

    Reads trips.txt from gtfs_dir.

    Args:
        gtfs_dir: Path to the directory containing GTFS text files.

    Returns:
        Dict mapping trip_id → service_id for every trip in the feed.
    """
    path = os.path.join(gtfs_dir, "trips.txt")
    trip_service: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            trip_service[row["trip_id"].strip()] = row["service_id"].strip()
    return trip_service


# ---------------------------------------------------------------------------
# Step 3 — stop_times.txt (streamed)
# ---------------------------------------------------------------------------


def parse_time_to_minutes(time_str: str) -> int:
    """
    Convert an HH:MM:SS time string to integer minutes since midnight.

    GTFS allows times beyond 24:00 for overnight trips (e.g. '25:30:00').
    These are stored as-is to preserve correct ordering across midnight.

    Args:
        time_str: Time string in 'HH:MM:SS' format. Hours may exceed 23.

    Returns:
        Integer minutes since midnight (may exceed 1439 for overnight times).

    Raises:
        ValueError: If time_str is not in the expected format.
    """
    parts = time_str.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"Invalid time string: {time_str!r}")
    return int(parts[0]) * 60 + int(parts[1])


def build_trip_stops(
    gtfs_dir: str,
    stop_to_uic: dict[str, str],
) -> dict[str, list[tuple[int, int]]]:
    """
    Stream stop_times.txt and build per-trip stop sequences.

    Reads stop_times.txt line by line (the file can be 70+ MB). Only rows
    whose stop_id appears in stop_to_uic are collected. Each qualifying row
    contributes a (uic_int, dep_minutes, stop_sequence) tuple to the trip's
    accumulator. After the full file is consumed, each trip's stops are
    sorted by stop_sequence and the sequence number is discarded.

    Trips with fewer than GTFS_MIN_STOPS_PER_TRIP qualifying stops are
    excluded, as they cannot support A→B queries.

    Args:
        gtfs_dir: Path to the directory containing GTFS text files.
        stop_to_uic: Dict mapping stop_id → uic_string (from load_filtered_stops).

    Returns:
        Dict mapping trip_id → list of (uic_int, dep_minutes) tuples,
        ordered by stop_sequence ascending.
    """
    path = os.path.join(gtfs_dir, "stop_times.txt")
    # Accumulator: trip_id → list of (seq, uic_int, dep_minutes)
    raw: dict[str, list[tuple[int, int, int]]] = defaultdict(list)

    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            sid = row["stop_id"].strip()
            if sid not in stop_to_uic:
                continue
            trip_id = row["trip_id"].strip()
            seq = int(row["stop_sequence"])
            dep_minutes = parse_time_to_minutes(row["departure_time"])
            uic_int = int(stop_to_uic[sid])
            raw[trip_id].append((seq, uic_int, dep_minutes))

    result: dict[str, list[tuple[int, int]]] = {}
    for trip_id, entries in raw.items():
        if len(entries) < GTFS_MIN_STOPS_PER_TRIP:
            continue
        entries.sort(key=lambda t: t[0])
        result[trip_id] = [(uic, dep) for _, uic, dep in entries]
    return result


# ---------------------------------------------------------------------------
# Step 4 — calendar_dates.txt
# ---------------------------------------------------------------------------


def load_service_dates(
    gtfs_dir: str,
    valid_service_ids: set[str],
) -> dict[str, list[int]]:
    """
    Load service operating dates for a subset of service IDs.

    Reads calendar_dates.txt. Only rows with exception_type '1' (service
    added) and a service_id present in valid_service_ids are kept.

    Args:
        gtfs_dir: Path to the directory containing GTFS text files.
        valid_service_ids: Set of service IDs to retain (from trip_service_map).

    Returns:
        Dict mapping service_id → sorted list of YYYYMMDD integer dates.
    """
    path = os.path.join(gtfs_dir, "calendar_dates.txt")
    dates: dict[str, list[int]] = defaultdict(list)
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            sid = row["service_id"].strip()
            if sid not in valid_service_ids:
                continue
            if row["exception_type"].strip() != "1":
                continue
            dates[sid].append(int(row["date"].strip()))
    return {sid: sorted(d) for sid, d in dates.items()}


# ---------------------------------------------------------------------------
# Step 5 — assemble compact index
# ---------------------------------------------------------------------------


def build_compact_index(
    trip_stops: dict[str, list[tuple[int, int]]],
    trip_service_map: dict[str, str],
    service_dates: dict[str, list[int]],
    stop_to_uic: dict[str, str],
) -> dict:
    """
    Assemble the final compact timetable index from the parsed GTFS data.

    Service IDs are remapped to short integer string keys to reduce JSON size.
    Each trip is stored as {'svc': int, 'type': int, 'stops': [[uic, dep_min], …]}.
    Train type is inferred from the first stop_id of each trip (via stop_to_uic
    reverse lookup).

    Args:
        trip_stops: trip_id → [(uic_int, dep_minutes), …] (from build_trip_stops).
        trip_service_map: trip_id → service_id (from load_trip_service_map).
        service_dates: service_id → [YYYYMMDD, …] (from load_service_dates).
        stop_to_uic: stop_id → uic_string (from load_filtered_stops).

    Returns:
        Dict with keys:
          'generated_at'  — ISO 8601 generation timestamp
          'train_types'   — list of train type names indexed by 'type' integer
          'date_range'    — {'min': YYYYMMDD, 'max': YYYYMMDD} or None
          'services'      — {short_int_key: [YYYYMMDD, …]}
          'trips'         — list of compact trip dicts
    """
    # Build reverse map: uic_str → train_type (from stop_to_uic)
    # We need the original stop_id to determine train type; infer from uic prefix.
    # Because both prefixes embed the UIC, the train type is determined by
    # which prefix the stop_id matched — we use the prefix constants directly.
    uic_to_train_type: dict[int, str] = {}
    for stop_id, uic_str in stop_to_uic.items():
        uic_to_train_type[int(uic_str)] = extract_train_type(stop_id)

    # Remap service IDs to short integer strings
    svc_to_short: dict[str, str] = {}
    svc_counter = 0
    services_compact: dict[str, list[int]] = {}

    def get_svc_key(service_id: str) -> str:
        nonlocal svc_counter
        if service_id not in svc_to_short:
            svc_counter += 1
            svc_to_short[service_id] = str(svc_counter)
        return svc_to_short[service_id]

    trips_list = []
    for trip_id, stops in trip_stops.items():
        service_id = trip_service_map.get(trip_id)
        if not service_id:
            continue
        dates = service_dates.get(service_id)
        if not dates:
            continue

        # Determine train type from first UIC in the trip
        first_uic = stops[0][0]
        train_type = uic_to_train_type.get(first_uic)
        if train_type is None:
            continue

        svc_key = get_svc_key(service_id)
        if svc_key not in services_compact:
            services_compact[svc_key] = dates

        trips_list.append({
            "svc": int(svc_key),
            "type": _TRAIN_TYPE_CODE[train_type],
            "stops": list(stops),
        })

    # Compute date range across all services
    all_dates = [d for dates in services_compact.values() for d in dates]
    date_range = (
        {"min": min(all_dates), "max": max(all_dates)} if all_dates else None
    )

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "train_types": _TRAIN_TYPE_NAMES,
        "date_range": date_range,
        "services": services_compact,
        "trips": trips_list,
    }


# ---------------------------------------------------------------------------
# Step 6 — write output
# ---------------------------------------------------------------------------


def write_index(index: dict, output_path: str) -> None:
    """
    Write the timetable index to a JSON file.

    Uses compact separators (no spaces) to minimise file size.
    Prints a summary of the output to stdout.

    Args:
        index: The compact index dict from build_compact_index().
        output_path: Destination file path. Parent directory must exist.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"), ensure_ascii=False)

    size_kb = os.path.getsize(output_path) // 1024
    n_trips = len(index.get("trips", []))
    n_svcs = len(index.get("services", {}))
    dr = index.get("date_range")
    date_range_str = f"{dr['min']}–{dr['max']}" if dr else "unknown"
    print(
        f"  Timetable written to {output_path}\n"
        f"  Trips: {n_trips:,}  |  Services: {n_svcs:,}  "
        f"|  Date range: {date_range_str}  |  Size: {size_kb:,} KB"
    )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def build_gtfs_index(gtfs_dir: str, output_path: str) -> None:
    """
    Build and write the GTFS timetable index.

    Orchestrates all parsing steps in order:
      1. Load French TER-train and Intercités stops
      2. Load trip → service mapping
      3. Stream stop_times to build trip stop sequences
      4. Load service operating dates
      5. Assemble compact index
      6. Write to output_path

    Args:
        gtfs_dir: Path to the GTFS feed directory.
        output_path: Destination path for the generated JSON index.
    """
    print("Building GTFS timetable index…")

    print("  [1/5] Loading filtered stops…")
    stop_to_uic = load_filtered_stops(gtfs_dir)
    print(f"        {len(stop_to_uic):,} qualifying stop IDs")

    print("  [2/5] Loading trip → service map…")
    trip_service_map = load_trip_service_map(gtfs_dir)
    print(f"        {len(trip_service_map):,} trips")

    print("  [3/5] Streaming stop_times.txt…")
    trip_stops = build_trip_stops(gtfs_dir, stop_to_uic)
    print(f"        {len(trip_stops):,} qualifying trips")

    valid_service_ids = {
        trip_service_map[tid]
        for tid in trip_stops
        if tid in trip_service_map
    }
    print(f"  [4/5] Loading service dates ({len(valid_service_ids):,} service IDs)…")
    service_dates = load_service_dates(gtfs_dir, valid_service_ids)
    print(f"        {len(service_dates):,} services with dates")

    print("  [5/5] Assembling compact index…")
    index = build_compact_index(trip_stops, trip_service_map, service_dates, stop_to_uic)

    write_index(index, output_path)
    print("Done.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    gtfs_dir_abs = os.path.join(project_root, GTFS_DIR)
    output_abs = os.path.join(project_root, GTFS_OUTPUT)
    build_gtfs_index(gtfs_dir_abs, output_abs)
