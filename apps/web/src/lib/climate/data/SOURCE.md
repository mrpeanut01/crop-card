# Frost normals source

`frost-normals-us.json` is derived from two NOAA NCEI products, both US Government work and public domain (17 U.S.C. §105).

## Frost dates: U.S. Climate Normals 1991-2020

Via NOAA Open Data Dissemination (AWS noaa-normals-pds).

- Archive: https://noaa-normals-pds.s3.amazonaws.com/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz
- Version: v1.0.1, c20230404
- SHA-256: `0fdb814203150780d4ee0c5d53c7844a237a21881101fb7d922b0aa3a1fd190f`
- Retrieved: 2026-09-26

## Extreme minimum: Global Summary of the Month (GSOM)

- Archive: https://www.ncei.noaa.gov/data/global-summary-of-the-month/archive/gsom-latest.tar.gz (1,506,835,215 bytes)
- Last-Modified: 2026-09-16T08:02:47Z
- SHA-256: `615ff1d5f8fbd190910f8acab2912171d3240079bbb2d5a05e9baae6a29f5c1b`
- Retrieved: 2026-09-26
- Documentation: https://www.ncei.noaa.gov/data/global-summary-of-the-month/doc/GSOM_GSOY_Description_Document_v1.0.2_20200219.pdf

NOAA replaces `gsom-latest.tar.gz` in place every few weeks, so a fresh download stops matching the pinned hash. Rebuild from a saved copy of the pinned file, or re-pin on purpose: update `GSOM_SHA256` and `GSOM_LAST_MODIFIED` in the build script and this file together, and expect small changes in `extremeMinF`.

`EMNT` is the month's lowest daily minimum temperature (°C in the archive), computed by NCEI from GHCN-Daily. For each station and calendar year 1991-2020, the annual extreme minimum is the lowest monthly `EMNT` of that year. A year counts only when January, February, March, November and December all carry an `EMNT`; across the U.S. stations 99.6% of annual minima fall in those months (checked against the dates in the Global Summary of the Year). A station needs at least 20 qualifying years. `extremeMinF` is the mean of those annual minima, converted to °F and rounded to 0.1 °F. Annual GSOY values were not used because GSOY blanks a whole year when any month is missing, which dropped many stations for summer gaps that say nothing about the coldest night.

Only stations in U.S. states and territories (`US`, `AQ`, `CQ`, `GQ`, `JQ`, `RQ`, `VQ`, `WQ` ids) get `extremeMinF`; GHCN-Daily notes that non-U.S. station data may carry use restrictions, so the Canadian and freely associated states' stations keep their frost dates only. 3,500 of the 7,094 stations have an `extremeMinF`.

## Rebuild

`node apps/web/scripts/build-frost-normals.mjs --archive <normals .tar.gz> --gsom <gsom .tar.gz>` (the script verifies both SHA-256s).

## Row format

Each station row is `[id, name, lat, lon, elevM, spring32P50, fall32P50, spring32P10, fall32P10, spring24P50, fall24P50, spring24P10, fall24P10, frostFree?, extremeMinF?]`. Dates are day-of-year in a non-leap year. A station is kept when its 32 °F P50 last-spring date is valid (6,949 stations), or when its mean annual count of days with a minimum at or below 32 °F is 0.0 (145 frost-free stations, flagged `1` with null dates). When a row carries `extremeMinF`, `frostFree` is written as `1` or `0`. NOAA sentinels (-4444, -5555, -6666, -7777, -9999) and blanks are stored as null.

NOAA's `FPxx` columns give the date with an xx% chance the frost event falls after it. The "cautious" (90%) reading therefore uses the P10 columns for both spring and fall.

## Hardiness zone

`lib/climate/zone.ts` turns `extremeMinF` into an approximate zone with the USDA map's 10 °F zones and 5 °F half-zones (0 to <5 °F is 7a). It is an estimate from one station, not the USDA Plant Hardiness Zone Map (a gridded PRISM product, not used here), and the app only displays it.

Station elevations are the `elevM` column already in each row (from the normals archive), so the zone work adds nothing to this file. The farm's elevation comes from the USGS Elevation Point Query Service (`https://epqs.nationalmap.gov/v1/json`, 3DEP, a U.S. Government work in the public domain), fetched server-side through `safeFetch` with no redirects, a 4 s timeout and a 4 KB cap, and cached in `weather_forecast_cache` under `elev:<lat>,<lon>` for a year (6 h for a miss). The lookup then runs in two passes:

1. The nearest station with `extremeMinF` within 50 mi, skipping any more than 1,000 ft above or below the farm when both elevations are known (a station with no recorded elevation is still accepted here).
2. Only when the farm's elevation is known and pass 1 found nothing: the nearest station within 100 mi whose own elevation is known and within 1,000 ft of the farm's. It is shown with its distance and "similar elevation".

The 1,000 ft band comes from the standard-atmosphere lapse rate of 6.5 °C/km (about 3.6 °F per 1,000 ft) against a 5 °F half-zone: inside the band, elevation alone cannot move the estimate a full half-zone. When the farm's elevation is unknown, only pass 1 runs, unguarded, exactly as before.
