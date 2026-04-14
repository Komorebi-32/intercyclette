# Transitous API — Notes d'utilisation

Sample response for reference: [transitous_sample_response.json](transitous_sample_response.json)
(Query: Paris Montparnasse → Pougny - Chancy, 2026-04-14 08:00 local)

---

## How to call the API manually

```bash
curl "https://api.transitous.org/api/v5/plan?\
fromPlace=FROM_LAT,FROM_LON\
&toPlace=TO_LAT,TO_LON\
&time=YYYY-MM-DDTHH:MM:SS.000Z\
&transitModes=RAIL\
&maxTransfers=5" | python3 -m json.tool > my_response.json
```

**Steps:**
1. **Get coordinates** — look up the station in `static/data/stations.json` for the `lat`/`lon` fields.
2. **Convert time to UTC** — the `time` param must be UTC. If you want to depart at 08:00 Paris local time (UTC+2 in summer), pass `06:00:00.000Z`.
3. **`transitModes`** — `RAIL` gives trains only. You can also try `RAIL,BUS` or omit it for all modes.
4. **Paginate** — use the `nextPageCursor` value from the response as a `cursor=...` param to get the next batch of journeys.

---

## Full response structure

### Top-level keys

| Key | Used by app? | Content |
|---|---|---|
| `requestParameters` | No | Echo of the query params sent |
| `debugOutput` | No | Server-side timing info |
| `from` | No | Resolved origin point (lat/lon/name) |
| `to` | No | Resolved destination point |
| `direct` | No | Direct (non-transit) options, empty for rail-only queries |
| `itineraries` | **Yes** | Array of journey options |
| `previousPageCursor` | No | Pagination token for earlier results |
| `nextPageCursor` | No | Pagination token for later results |

---

### Each itinerary

| Key | Used by app? | Content |
|---|---|---|
| `duration` | No | Total journey duration in **seconds** |
| `startTime` | No | ISO UTC start time |
| `endTime` | No | ISO UTC end time |
| `transfers` | **Yes** (as `nb_transfers`) | Number of vehicle changes |
| `legs` | **Yes** | Array of legs (walk + transit segments) |

---

### Each leg (transit legs only — mode ≠ WALK)

| Key | Used by app? | Notes |
|---|---|---|
| `mode` | **Yes** | `REGIONAL_RAIL`, `SUBWAY`, `WALK`, etc. |
| `from.name` / `to.name` | **Yes** | Station display names |
| `from.departure` / `to.arrival` | **Yes** | UTC ISO datetimes |
| `from.scheduledDeparture` / `to.scheduledArrival` | No | Scheduled time (before delays) |
| `realTime` | No | `true` if live data, `false` if scheduled only |
| `scheduled` | No | `false` means real-time override is active |
| `cancelled` | No | `true` if the service is cancelled |
| `bikesAllowed` | No | `true`/`false` — directly useful for this app |
| `routeShortName` | No | Train number, e.g. `"9773"` |
| `routeLongName` | No | Full commercial name |
| `agencyName` | No | Operator, e.g. `"SNCF"`, `"CFF/SBB"` |
| `agencyUrl` | No | Operator website |
| `tripId` | No | Internal trip identifier |
| `routeColor` / `routeTextColor` | No | Brand colors |
| `headsign` | No | Destination shown on the train (or trip number) |
| `intermediateStops` | No | All stops between `from` and `to` |
| `alerts` | No | Disruption messages |
| `interlineWithPreviousLeg` | No | `true` if you stay on the same physical train |
| `from.stopId` / `to.stopId` | No | GTFS stop ID |
| `from.parentId` / `to.parentId` | No | Parent station ID |
| `from.modes` / `to.modes` | No | Transit modes available at that stop |
| `legGeometry` | No | Encoded polyline of the leg's path |

---

## Fields of interest not yet used by the app

- **`bikesAllowed`** — answers "can I bring my bike on this train?" directly.
- **`realTime`** / **`scheduled`** — whether the timetable is live or static.
- **`cancelled`** — could be used to warn users of disrupted journeys.
- **`intermediateStops`** — useful for showing all stops along a leg.
- **`agencyName`** — operator name (SNCF, CFF, etc.), useful for bike policy info.
- **`nextPageCursor`** — enables fetching additional journey options beyond the first batch.
