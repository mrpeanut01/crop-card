# Weather sources

Research for the "Weather-model limits" follow-up (network task brief, Task 2). Items 1 to 3
are below; item 4 (NWS frost and freeze alerts) is the last section.
Checked 2026-09-26 from a machine with normal internet access. CropCard charges owners a hosting
fee, so any source limited to non-commercial use is ruled out.

## Summary

| Question                          | Source                                      | Reachable                    | Licensed for a paid app                                                                      | Built   |
| --------------------------------- | ------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- | ------- |
| Station leaf wetness near Loudoun | NEWA (Cornell)                              | Yes (undocumented endpoints) | **No published license**; NEWA's only third-party data offer is a paid per-station agreement | No      |
| Past hourly weather               | NOAA NCEI GHCNh via the Access Data Service | Yes                          | Yes, public domain                                                                           | **Yes** |
| Gap between GHCNh and now         | NWS observations, `api.weather.gov`         | Yes                          | Yes, open data                                                                               | **Yes** |
| Past hourly weather               | Open-Meteo historical API                   | Yes                          | Free tier is non-commercial only                                                             | No      |
| FHB (scab) risk                   | wheatscab.psu.edu (Penn State / USWBSI)     | No (host down off-season)    | No API, no terms                                                                             | No      |

## 1. NEWA station data (leaf wetness)

**What exists.** NEWA's web app (a Gatsby site at newa.cornell.edu) reads two undocumented
back ends that answer without authentication:

- `GET https://newa.rcc-acis.workers.dev/v0/stations`: 1,371 stations with id, coordinates,
  sensor list (`lwet` = leaf-wetness sensor), `activeStatus` and owner affiliation.
- `POST https://hrly.nrcc.cornell.edu/stnHrly` with `{"sid":"va_lees nwon","sdate":"2026092400","edate":"now"}`:
  hourly observed data plus NEWA's own forecast for that station.

**Stations within 25 miles of Leesburg (39.1157, -77.5636):**

| Station                            | NEWA id        | Distance | Leaf wetness sensor | Active | Owner                           |
| ---------------------------------- | -------------- | -------- | ------------------- | ------ | ------------------------------- |
| Leesburg (Zephaniah Vineyard)      | `va_lees nwon` | 3.9 mi   | yes                 | yes    | Virginia Tech (grape pathology) |
| Paeonian Springs (Twin Notch)      | `va_pae newa`  | 3.8 mi   | yes                 | no     | NEWA in Virginia                |
| Paeonian Springs (Twin Notch Farm) | `va_pstn nwon` | 3.9 mi   | yes                 | no     | Virginia Tech                   |
| Waterford (Bethany Ridge)          | `va_psp newa`  | 4.7 mi   | yes                 | no     | Virginia Tech                   |
| Hillsboro                          | `va_hil newa`  | 11.8 mi  | yes                 | yes    | Loudoun Gov / VCE / VT          |
| Dulles Airport                     | `kiad icao`    | 13.2 mi  | no (RH proxy)       | yes    | NWS                             |
| Bluemont                           | `va_blu newa`  | 15.1 mi  | yes                 | yes    | Loudoun Gov / VCE / VT          |
| Delaplane                          | `va_del newa`  | 23.0 mi  | yes                 | yes    | Virginia Tech                   |
| Kearneysville, WV                  | `wv_kear nwon` | 23.8 mi  | yes                 | yes    | USDA-ARS                        |
| Mount Airy, MD                     | `md_mtai nwon` | 24.7 mi  | yes                 | yes    | Rock Hill Orchard               |

**Terms.** `newa.cornell.edu/terms` is only a privacy policy; it says nothing about reuse of
station data or automated access. Neither API is documented. The stations belong to their
owners: "The weather stations are owned by farmers, commodity groups, agricultural industries,
private consultants and land grant universities" (newa.cornell.edu/about-us). The one published
data-sharing arrangement is the NEWA Data Disclaimer and Agreement
(<https://blogs.cornell.edu/newa/disclaimer>): "For an annual fee of $55, fifty-five US dollars,
NEWA ... is providing data from one NEWA weather station location formatted for use with
RIMpro", an agreement "between the USER and Cornell University". So NEWA does license station
feeds to third-party software, but by agreement and per station, not through an open API.

**Decision: not built.** No license covers a commercial app pulling grower-owned station data
from undocumented endpoints. The route forward is a written agreement with NEWA
(newa@cornell-ipm.org), modelled on the RIMpro arrangement, for the Loudoun stations above.
With one in hand, `lib/server/weatherNewa.ts` would call `stnHrly` for the nearest active
`lwet` station and tag the values `data` with the station name.

**Related finding.** NEWA uses the same proxy CropCard does where a station has no sensor:
"For these stations, NEWA records an hour of leaf wetness when the average relative humidity in
that hour is greater than 90%" (newa.cornell.edu/how-newa-handles-weather-data). NEWA also
adjusts airport and NWS-forecast RH toward field conditions with
`adjRH = RH / (0.0047*RH + 0.53)`. CropCard does not apply that adjustment today.

## 2. Past hourly weather (vernalization, FHB window)

### Candidates

- **NOAA NCEI GHCNh** (Global Historical Climatology Network hourly, the successor to ISD).
  Public domain: "These data are in the public domain in the United States" (NCEI PD-10-2-02,
  Open Data Policy, <https://www.ncei.noaa.gov/sites/default/files/2023-12/NCEI%20PD-10-2-02%20-%20Open%20Data%20Policy%20Signed.pdf>).
  Access paths tested:
  - Access Data Service, `https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-historical-climatology-network-hourly&stations=USW00003714&startDate=…&endDate=…&dataTypes=DATE,temperature,…&format=json`.
    One station-month is about 180 KB of JSON and returns in under a second. **`DATE` must be
    listed in `dataTypes`**; without it the rows carry no timestamp. `units=standard` is
    ignored for this dataset (values stay °C).
  - Per-station yearly PSV files on NCEI and the AWS Open Data mirror (`noaa-ghcnh-pds`):
    36 MB per station-year for Dulles, too heavy to fetch on demand.
  - Latency: rows end about 1.5 days before now (KJYO and KIAD both ended 2026-09-24 ~22:00 UTC
    when checked on 2026-09-26). The Dulles 2026 PSV also held three precipitation-only rows
    dated 2026-10-04, so rows after "now" are dropped.
  - The old ISD `global-hourly` dataset returns nothing for 2026 (ISD is retired), and the
    `noaa-isd-pds` mirror has no 2026 files.
- **NWS observations** (`api.weather.gov/stations/{ICAO}/observations`). Open data: "All of the
  information presented via the API is intended to be open data, free to use for any purpose"
  (<https://www.weather.gov/documentation/services-web-api>). Only about 7 days are retained
  (a request for 2026-09-10 returned nothing on 2026-09-26), so it can fill GHCNh's latency gap
  but cannot cover a season. Responses are heavy (about 2 MB for 7 days of 20-minute AWOS reports).
- **Open-Meteo historical API.** Terms (<https://open-meteo.com/en/terms>): "You may only use
  the free API services for non-commercial purposes", and commercial use explicitly includes
  "Operating websites or apps that have subscriptions". A paid API subscription would be needed.
  It is also model reanalysis rather than station observation. Ruled out.
- **RCC-ACIS** (`data.rcc-acis.org`) serves daily max/min only, not hourly.
- **Iowa Environmental Mesonet** ASOS archive is not a primary agency source.

### Decision: built with GHCNh + NWS observations

`apps/web/src/lib/server/weatherObserved.ts` + `GET /api/weather/observed?blockId=…&from=<ms>`:

1. Station: the nearest of 2,694 U.S. GHCNh stations that carry an ICAO id, within 30 miles
   (bundled at `lib/server/data/ghcnh-stations-us.json`, built by
   `apps/web/scripts/build-ghcnh-stations.mjs` from the NCEI station list, SHA-256 pinned).
   For Leesburg that is Leesburg Executive Airport (KJYO, `USW00003714`, 2.6 mi), then Dulles.
   Up to three stations are tried.
2. GHCNh through the Access Data Service, one request per UTC calendar month, through
   `safeFetch` (host pinned to `www.ncei.noaa.gov/access/services/data/v1`, no redirects,
   20 s timeout, 3 MB cap). Values failing GHCNh QC (legacy codes 2/3/6/7, or any lowercase
   failed-check letter) are dropped; reports are bucketed to the nearest hour and averaged.
   Cached in the global `weather_forecast_cache` under `observed:<ghcnId>:<YYYY-MM>`: 30 days
   once a month has been closed for 10 days, 6 hours otherwise.
3. NWS observations for the same ICAO fill hours after the last GHCNh hour (existing
   `nwsFetch`, host already pinned). Cached 1 h.
4. Precipitation is left null. GHCNh "hourly" totals "may include intermediate reports within
   the hour" (GHCNh documentation §IX), so they cannot be summed safely.

**Provenance.** Observed hours carry `data`, and the UI names the station ("NOAA observed ·
Leesburg Executive AP (KJYO)"). No station within 30 miles, or both feeds failing, returns
`fallback` with no hours, and `/plan/wheat` keeps its Dulles-normals climatology (tagged
`fallback`) for any hour without an observation. Nothing gates on these values.

`/plan/wheat` merges observed hours (before now) with the NWS hourly forecast (from now on).
Vernalization and the FHB window both read the merged series.

## 3. Fusarium head blight (scab) model

The national model is the Fusarium Head Blight Risk Tool at <https://www.wheatscab.psu.edu/>
(Penn State with Kansas State and Ohio State, funded by the U.S. Wheat and Barley Scab
Initiative). Findings:

- The host (`met-wheatfe.vmhost.psu.edu`, 146.186.152.76) refused connections on ports 80 and
  443 on 2026-09-26. The tool runs "April through August" and appears to be offline outside
  the season.
- An archived copy of the page (Wayback, 2026-08-01) shows it is an OpenLayers map drawing WMS
  and WFS layers from a GeoServer at `met-wheatfe.met.psu.edu/geoserver/ws/…`. That is a map
  back end, not a documented API, and the site publishes no terms of use or data license.
- The state extension pages found in a search (Ohio State, Maryland, Delaware, Purdue, SDSU)
  describe or link to the national tool; none documents a data feed of its own. No state
  version covering Virginia was found.
- The USWBSI "FHB Alerts" (scabusa.org) are commentary by email or text, not data.

**Decision: not built.** The `/plan/wheat` FHB panel stays a labelled proxy with a link to
wheatscab.psu.edu. It now counts observed station hours in the 7 days before flowering when that
window is in the past, instead of only forecast hours. A GeoServer feed could be revisited if
Penn State publishes terms or grants permission (contact via scabusa.org).

## 4. NWS frost and freeze alerts

Checked 2026-09-26 against the live API with the `User-Agent` that `apps/web/src/lib/server/weather.ts` sends.

- **Endpoint.** `GET https://api.weather.gov/alerts/active?point=<lat>,<lon>` (`Accept: application/geo+json`) returns a GeoJSON `FeatureCollection` of the watches, warnings and advisories in force for the forecast zone and county that contain the point. No key. On 2026-09-26 the Leesburg point (39.1157,-77.5636) had none, and the response was a `FeatureCollection` with an empty `features` array.
- **Frost products are there.** `GET /alerts?event=Frost%20Advisory` and `?event=Freeze%20Warning` (history, about the last 7 days) returned real products: NWS Baltimore/Washington (LWX) issued a Frost Advisory for Garrett County, MD and nearby VA/WV highland zones for the night of 2026-09-24, and NWS Marquette (MQT) issued a Freeze Warning on 2026-09-21. `GET /alerts?point=39.55,-79.35` (inside the Garrett advisory) returned the whole life of that advisory, so the `point` filter matches zone-based frost products.
- **Shape.** Each message is its own feature: the advisory above came as `NEW`, then `EXA`/`CON` updates, then `EXP`, all sharing the VTEC event tracking number `KLWX.FR.Y.0007`. `properties.event` is the product name (`Frost Advisory`, `Freeze Watch`, `Freeze Warning`, `Hard Freeze Watch`, `Hard Freeze Warning`), `onset` and `ends` give the cold period (`ends` can be null; `expires` is the message expiry), `messageType` is `Alert | Update | Cancel`, and `parameters.NWSheadline[0]` is a short all-caps summary. `geometry` is null for these zone-based products.
- **Terms.** NWS data is a US Government work and not subject to copyright; api.weather.gov asks only for an identifying `User-Agent` and polite request rates. Fine for a paid app.

**What CropCard does with it.** An opt-in "Frost tonight" push alert (`frost-tonight` in `lib/push/prefs.ts`, off by default, toggled on `/settings/notifications`). Each scheduled push tick (twice a day, 10:00 and 20:00 UTC, from the `push-tick` Container Apps Job), for an Owner with at least one subscription that turned it on, a real farm location (a mapped block or saved farm coordinates, never the Loudoun default) and a planting that is `tender` (or `half-hardy`, for hard freeze products) by `scheduleCandidacy.hardinessOf` and is active or planned within 30 days back / 14 days ahead, the scheduler asks NWS for active alerts at that point (`lib/server/nwsAlerts.ts`: `safeFetch`, api.weather.gov only, no redirects, 8 s, 1 MB, 10-minute per-point cache). Products whose cold starts within 36 hours produce one alert each; the sent-log key is the VTEC product plus year, so updates and continuations never re-send. An NWS failure skips that tick. Recorded payloads are in `apps/web/src/lib/server/__fixtures__/nws-alerts-*.json`.
