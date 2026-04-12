# Performance Notes

## Housing export script (`scripts/export_housing_json.py`)

### Current behaviour (as of housing-points branch)

Processing 57 494 housing features against 9 Eurovelo GPX routes takes roughly
**8 minutes per route** (≈ 70 minutes total) on a typical laptop. CPU is
pegged at 100 % throughout.

The main bottleneck is `closest_point_on_route_km()` in
`app/geo/station_matcher.py`.  For every housing feature that passes the
spatial-grid pre-filter (i.e. is within ≈ 11 km of the route), this function
iterates the **entire route polyline** (up to 76 000 points for EV3) to find
the closest point and its cumulative-km value.  EV3 passes through heavily
populated parts of France, so thousands of features trigger this O(N) scan.

### Identified optimisation — use local sub-polyline for exact distance

The spatial-grid pre-filter already retrieves the subset of route points
within `BBOX_MARGIN_DEG` (0.1 ° ≈ 11 km) of the feature.  Because
`max_distance_km` (5 km) < `BBOX_MARGIN_DEG` (11 km), the true closest
point on the route is **guaranteed to lie inside this local sub-polyline**.

**Change required** — in `find_features_near_route()`:

1. Refactor `_extract_local_polyline_from_grid` to also return the
   **sorted point indices** (not just the points themselves).

2. Build a `local_cum_km` list from those indices:
   ```python
   local_cum_km = [cum_km[i] for i in sorted_indices]
   ```
   These values are taken from the full-route cumulative array, so the
   returned `cum_km_at_closest` correctly reflects the position along the
   entire route.

3. Replace the final exact-distance call:
   ```python
   # before (O(N_full)):
   dist_km, cum_km_at_closest = closest_point_on_route_km(
       lat, lon, polyline, cum_km
   )
   # after (O(k), k ≈ 20–200 nearby points):
   dist_km, cum_km_at_closest = closest_point_on_route_km(
       lat, lon, local_polyline, local_cum_km
   )
   ```

Expected speedup: **100–1 000 ×** for the exact-distance step, bringing
total export time from ≈ 70 minutes to well under 1 minute.

### Secondary optimisation — pre-compute feature centroids once

`_extract_lat_lon()` is called once per feature **per route** (9 ×).  For
Polygon features (≈ 30 000 out of 57 494) this involves iterating the
exterior ring.  Pre-computing all `(lat, lon)` values once before the route
loop and storing them alongside the features would eliminate 8 redundant
centroid calculations per polygon.

This is a minor optimisation compared to the exact-distance fix above.
