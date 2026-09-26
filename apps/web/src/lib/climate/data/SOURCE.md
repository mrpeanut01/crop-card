# Frost normals source

`frost-normals-us.json` is derived from two NOAA NCEI products on NOAA Open Data Dissemination (AWS), both US Government works in the public domain (17 U.S.C. §105).

## Frost dates: U.S. Climate Normals 1991-2020

- Archive: https://noaa-normals-pds.s3.amazonaws.com/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz
- Version: v1.0.1, c20230404
- SHA-256: `0fdb814203150780d4ee0c5d53c7844a237a21881101fb7d922b0aa3a1fd190f`
- Retrieved: 2026-09-26

## Extreme minimum: GHCN-Daily, 1991-2020

- Files: `https://noaa-ghcn-pds.s3.amazonaws.com/csv.gz/by_year/1991.csv.gz` through `2020.csv.gz` (30 files, about 4.7 GB)
- Version: GHCN-Daily 3.34-upd-2026092418 (last full reprocess 3.34-por-2026091823)
- SHA-256: one per year, pinned in `GHCN_SHA256` in `apps/web/scripts/build-frost-normals.mjs` and copied into the JSON's `extremeMin.sha256`
- Retrieved: 2026-09-26

The GHCN-Daily mirror rewrites its by-year files every day, so the pinned hashes describe the bytes fetched on that date. A rebuild needs those bytes, or a deliberate re-pin (`--repin-ghcn` prints the new hashes to paste in, then rebuild and review the diff).

The NOAA normals archive carries no extreme-minimum column, which is why the second source is used. For each station, each calendar year's lowest daily minimum (`TMIN` with a blank quality flag) counts when December, January and February (June, July and August south of the equator) each have at least 25 such days. `extremeMinF` is the mean of the counted years in °F, to one decimal, and is written only when at least 15 of the 30 years count. This is the station quantity the USDA zone map is built on, but the map itself comes from a gridded model (PRISM), so a zone derived here is approximate.

## Rebuild

```sh
node apps/web/scripts/build-frost-normals.mjs --archive <normals .tar.gz> --ghcn-dir <dir with 1991.csv.gz .. 2020.csv.gz>
```

The script verifies every SHA-256 before reading. Node's `fetch` ignores `HTTPS_PROXY`, so behind a proxy download with curl first.

## Shape

Each station row is `[id, name, lat, lon, elevM, spring32P50, fall32P50, spring32P10, fall32P10, spring24P50, fall24P50, spring24P10, fall24P10, frostFree?, extremeMinF?]`. Dates are day-of-year in a non-leap year. A station is kept when its 32 °F P50 last-spring date is valid (6,949 stations), or when its mean annual count of days with a minimum at or below 32 °F is 0.0 (145 frost-free stations, flagged `1`). `frostFree` is `1` or `0` and is present whenever `extremeMinF` is; both are omitted from a row that has neither. NOAA sentinels (-4444, -5555, -6666, -7777, -9999) and blanks are stored as null.

NOAA's `FPxx` columns give the date with an xx% chance the frost event falls after it. The "cautious" (90%) reading therefore uses the P10 columns for both spring and fall.

At about 140 warm stations the 32 °F frost season is a few weeks around the new year, so the last spring date falls in late December or the first fall date in early January (`crossesYear`). `lib/schedule/frostSeason.ts` places those dates in the right calendar years for the planner.
