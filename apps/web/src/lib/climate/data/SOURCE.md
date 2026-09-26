# Frost normals source

`frost-normals-us.json` is derived from NOAA NCEI U.S. Climate Normals 1991-2020, via NOAA Open Data Dissemination (AWS noaa-normals-pds); US Government work, public domain.

- Archive: https://noaa-normals-pds.s3.amazonaws.com/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz
- Version: v1.0.1, c20230404
- SHA-256: `0fdb814203150780d4ee0c5d53c7844a237a21881101fb7d922b0aa3a1fd190f`
- Retrieved: 2026-09-26
- Rebuild: `node apps/web/scripts/build-frost-normals.mjs --archive <downloaded .tar.gz>` (the script verifies the SHA-256).

Each station row is `[id, name, lat, lon, elevM, spring32P50, fall32P50, spring32P10, fall32P10, spring24P50, fall24P50, spring24P10, fall24P10, frostFree?]`. Dates are day-of-year in a non-leap year. A station is kept when its 32 °F P50 last-spring date is valid (6,949 stations), or when its mean annual count of days with a minimum at or below 32 °F is 0.0 (145 frost-free stations, flagged `1` with null dates). NOAA sentinels (-4444, -5555, -6666, -7777, -9999) and blanks are stored as null.

NOAA's `FPxx` columns give the date with an xx% chance the frost event falls after it. The "cautious" (90%) reading therefore uses the P10 columns for both spring and fall.
