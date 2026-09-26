#!/usr/bin/env node
/**
 * Builds apps/web/src/lib/climate/data/frost-normals-us.json from the NOAA
 * NCEI U.S. Climate Normals 1991-2020 annual/seasonal archive (public domain,
 * 17 U.S.C. §105), mirrored on NOAA Open Data Dissemination (AWS
 * noaa-normals-pds). Run once; the output is committed. CI never runs this.
 *
 * Each U.S. station also gets `extremeMinF`, the 1991-2020 mean of its annual
 * extreme minimum temperature, from the NOAA NCEI Global Summary of the Month
 * (GSOM) archive (monthly EMNT, derived from GHCN-Daily; U.S. data public
 * domain). Monthly rather than annual summaries because GSOY blanks a whole
 * year when any month is missing, and a missing July says nothing about the
 * coldest night.
 *
 *   node scripts/build-frost-normals.mjs                                  # download + build
 *   node scripts/build-frost-normals.mjs --archive f.tgz --gsom g.tgz     # build from local copies
 *
 * Node 22's fetch ignores HTTPS_PROXY; behind a proxy, download with curl
 * first and pass --archive / --gsom. Both SHA-256s are verified either way.
 * NOAA replaces gsom-latest.tar.gz in place every few weeks, so a fresh
 * download will stop matching GSOM_SHA256: keep the pinned copy to rebuild,
 * or re-pin deliberately (new hash, Last-Modified and SOURCE.md together).
 */

import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

export const SOURCE_URL =
  'https://noaa-normals-pds.s3.amazonaws.com/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz';
export const SOURCE_VERSION = 'v1.0.1 c20230404';
export const SOURCE_SHA256 = '0fdb814203150780d4ee0c5d53c7844a237a21881101fb7d922b0aa3a1fd190f';

export const GSOM_URL =
  'https://www.ncei.noaa.gov/data/global-summary-of-the-month/archive/gsom-latest.tar.gz';
export const GSOM_LAST_MODIFIED = '2026-09-16T08:02:47Z';
export const GSOM_SHA256 = '615ff1d5f8fbd190910f8acab2912171d3240079bbb2d5a05e9baae6a29f5c1b';
export const EXTREME_MIN_FIRST_YEAR = 1991;
export const EXTREME_MIN_LAST_YEAR = 2020;
/** A year counts only when January-March and November-December all carry a
 *  monthly EMNT: across the U.S. stations, 99.6% of annual minima fall in
 *  those months. The year's value is the lowest EMNT of the months present. */
export const EXTREME_MIN_REQUIRED_MONTHS = [1, 2, 3, 11, 12];
/** Qualifying years of the 30 a station needs. */
export const EXTREME_MIN_MIN_YEARS = 20;
/** U.S. states and territories only: GHCN-Daily marks non-U.S. station data
 *  as possibly restricted, so the Canadian and freely associated states'
 *  stations keep their frost dates but get no extreme minimum. */
const EXTREME_MIN_PREFIXES = ['US', 'AQ', 'CQ', 'GQ', 'JQ', 'RQ', 'VQ', 'WQ'];

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/lib/climate/data/frost-normals-us.json');

export const DATE_COLUMNS = [
  'ANN-TMIN-PRBLST-T32FP50',
  'ANN-TMIN-PRBFST-T32FP50',
  'ANN-TMIN-PRBLST-T32FP10',
  'ANN-TMIN-PRBFST-T32FP10',
  'ANN-TMIN-PRBLST-T24FP50',
  'ANN-TMIN-PRBFST-T24FP50',
  'ANN-TMIN-PRBLST-T24FP10',
  'ANN-TMIN-PRBFST-T24FP10'
];
const FREEZE_DAYS_COLUMN = 'ANN-TMIN-AVGNDS-LSTH032';

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** `MM/DD` → day of a non-leap year (1..365); anything else (sentinels, blanks) → null. */
export function parseMmDd(raw) {
  const m = /^\s*(\d{2})\/(\d{2})\s*$/.exec(raw ?? '');
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > MONTH_DAYS[month - 1]) return null;
  return CUM_DAYS[month - 1] + day;
}

const KEEP_UPPER = new Set([
  'AP',
  'AFB',
  'NAS',
  'MCAS',
  'NWS',
  'WSO',
  'WFO',
  'FAA',
  'DC',
  'US',
  'USA',
  'TV',
  'NWR',
  'NP',
  'SP',
  'RS',
  'EXP',
  'II',
  'III'
]);

/** "WASHINGTON DC DULLES AP, VA US" → "Washington DC Dulles AP, VA". */
export function titleCaseStation(raw) {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/\s+US$/, '');
  const comma = trimmed.lastIndexOf(',');
  const place = comma >= 0 ? trimmed.slice(0, comma) : trimmed;
  const state = comma >= 0 ? trimmed.slice(comma + 1).trim() : '';
  const words = place
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w) => {
      if (!/[a-z]/.test(w)) return w;
      if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join('');
  return state ? `${words}, ${state}` : words;
}

/** Minimal RFC 4180 line splitter (the NOAA files quote the NAME column). */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** One station CSV (header + one data row) → output row, or null to drop it. */
export function stationRow(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const values = splitCsvLine(lines[1]);
  const get = (k) => {
    const i = header.indexOf(k);
    return i >= 0 ? values[i] : undefined;
  };
  const id = (get('STATION') ?? '').trim();
  const lat = Number(get('LATITUDE'));
  const lon = Number(get('LONGITUDE'));
  const elev = Number(get('ELEVATION'));
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dates = DATE_COLUMNS.map((c) => parseMmDd(get(c)));
  const freezeDaysRaw = (get(FREEZE_DAYS_COLUMN) ?? '').trim();
  const freezeDays = freezeDaysRaw === '' ? NaN : Number(freezeDaysRaw);
  const frostFree = dates[0] === null && Number.isFinite(freezeDays) && freezeDays === 0;
  if (dates[0] === null && !frostFree) return null;
  const row = [
    id,
    titleCaseStation(get('NAME')),
    Math.round(lat * 10_000) / 10_000,
    Math.round(lon * 10_000) / 10_000,
    Number.isFinite(elev) && elev > -999 ? Math.round(elev) : null,
    ...dates
  ];
  if (frostFree) row.push(1);
  return row;
}

export function extremeMinEligible(id) {
  return EXTREME_MIN_PREFIXES.includes(String(id ?? '').slice(0, 2));
}

/**
 * One GSOM station CSV → the 1991-2020 mean of its annual extreme minimum
 * in °F (0.1 °F), or null with fewer than EXTREME_MIN_MIN_YEARS qualifying
 * years. GSOM archive values are metric (°C); the mean is taken in °C and
 * converted once.
 */
export function meanExtremeMinF(csvText) {
  const lines = String(csvText ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const dateIdx = header.indexOf('DATE');
  const emntIdx = header.indexOf('EMNT');
  if (dateIdx < 0 || emntIdx < 0) return null;
  const byYear = new Map();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const m = /^(\d{4})-(\d{2})$/.exec((cols[dateIdx] ?? '').trim());
    if (!m) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year < EXTREME_MIN_FIRST_YEAR || year > EXTREME_MIN_LAST_YEAR || month < 1 || month > 12) {
      continue;
    }
    const raw = (cols[emntIdx] ?? '').trim();
    if (raw === '') continue;
    const c = Number(raw);
    if (!Number.isFinite(c) || c < -90 || c > 50) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year).set(month, c);
  }
  const annual = [];
  for (const months of byYear.values()) {
    if (!EXTREME_MIN_REQUIRED_MONTHS.every((mo) => months.has(mo))) continue;
    annual.push(Math.min(...months.values()));
  }
  if (annual.length < EXTREME_MIN_MIN_YEARS) return null;
  const meanC = annual.reduce((a, b) => a + b, 0) / annual.length;
  return Math.round(meanC * 18 + 320) / 10;
}

async function* tarEntries(stream) {
  let buf = Buffer.alloc(0);
  let pending = null;
  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (!pending) {
        if (buf.length < 512) break;
        const header = buf.subarray(0, 512);
        if (header.every((b) => b === 0)) return;
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, ''), 8);
        const type = String.fromCharCode(header[156] || 48);
        pending = {
          name: prefix ? `${prefix}/${name}` : name,
          size: Number.isFinite(size) ? size : 0,
          type
        };
        buf = buf.subarray(512);
      }
      const padded = Math.ceil(pending.size / 512) * 512;
      if (buf.length < padded) break;
      const body = buf.subarray(0, pending.size);
      if (pending.type === '0' || pending.type === '\0') yield { name: pending.name, body };
      buf = buf.subarray(padded);
      pending = null;
    }
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  let archive = arg('--archive');
  if (!archive) {
    archive = resolve(process.env.TMPDIR ?? '/tmp', 'noaa-normals-annualseasonal.tar.gz');
    console.log(`downloading ${SOURCE_URL}`);
    await download(SOURCE_URL, archive);
  }
  const digest = await sha256File(archive);
  if (digest !== SOURCE_SHA256) {
    throw new Error(`SHA-256 mismatch: expected ${SOURCE_SHA256}, got ${digest}`);
  }
  let gsom = arg('--gsom');
  if (!gsom) {
    gsom = resolve(process.env.TMPDIR ?? '/tmp', 'noaa-gsom-latest.tar.gz');
    console.log(`downloading ${GSOM_URL}`);
    await download(GSOM_URL, gsom);
  }
  const gsomDigest = await sha256File(gsom);
  if (gsomDigest !== GSOM_SHA256) {
    throw new Error(
      `GSOM SHA-256 mismatch: expected ${GSOM_SHA256}, got ${gsomDigest}. NOAA replaces this archive in place; rebuild from the pinned copy or re-pin deliberately.`
    );
  }

  const stations = [];
  let seen = 0;
  for await (const entry of tarEntries(createReadStream(archive).pipe(createGunzip()))) {
    if (!entry.name.endsWith('.csv')) continue;
    seen++;
    const row = stationRow(entry.body.toString('utf8'));
    if (row) stations.push(row);
  }
  stations.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const wanted = new Map(
    stations.filter((s) => extremeMinEligible(s[0])).map((s) => [`${s[0]}.csv`, s])
  );
  let withExtremeMin = 0;
  for await (const entry of tarEntries(createReadStream(gsom).pipe(createGunzip()))) {
    const base = entry.name.slice(entry.name.lastIndexOf('/') + 1);
    const row = wanted.get(base);
    if (!row) continue;
    const f = meanExtremeMinF(entry.body.toString('utf8'));
    if (f === null) continue;
    while (row.length < 14) row.push(row.length === 13 ? 0 : null);
    row.push(f);
    withExtremeMin++;
  }

  const out = {
    source: SOURCE_URL,
    dataset: 'NOAA NCEI U.S. Climate Normals 1991-2020, annual/seasonal, by station',
    version: SOURCE_VERSION,
    sha256: SOURCE_SHA256,
    extremeMin: {
      source: GSOM_URL,
      dataset:
        'NOAA NCEI Global Summary of the Month (EMNT, from GHCN-Daily), mean of 1991-2020 annual extreme minima',
      lastModified: GSOM_LAST_MODIFIED,
      sha256: GSOM_SHA256,
      requiredMonths: EXTREME_MIN_REQUIRED_MONTHS,
      years: `${EXTREME_MIN_FIRST_YEAR}-${EXTREME_MIN_LAST_YEAR}`,
      minYears: EXTREME_MIN_MIN_YEARS,
      units: 'degF, 0.1'
    },
    retrieved: new Date().toISOString().slice(0, 10),
    license: 'US Government work, public domain (17 U.S.C. §105)',
    columns: [
      'id',
      'name',
      'lat',
      'lon',
      'elevM',
      'lastSpring32P50',
      'firstFall32P50',
      'lastSpring32P10',
      'firstFall32P10',
      'lastSpring24P50',
      'firstFall24P50',
      'lastSpring24P10',
      'firstFall24P10',
      'frostFree?',
      'extremeMinF?'
    ],
    dayOfYear: 'non-leap year, Jan 1 = 1',
    stations
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const body = JSON.stringify(out).replace(/\],\[/g, '],\n[');
  writeFileSync(OUT, body + '\n');
  const frostFree = stations.filter((s) => s[13] === 1).length;
  console.log(
    `read ${seen} station files; wrote ${stations.length} rows (${frostFree} frost-free, ${withExtremeMin} with extremeMinF) to ${OUT} (${Buffer.byteLength(body)} bytes)`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
