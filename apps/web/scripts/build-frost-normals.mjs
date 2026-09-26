#!/usr/bin/env node
/**
 * Builds apps/web/src/lib/climate/data/frost-normals-us.json from the NOAA
 * NCEI U.S. Climate Normals 1991-2020 annual/seasonal archive (public domain,
 * 17 U.S.C. §105), mirrored on NOAA Open Data Dissemination (AWS
 * noaa-normals-pds). Run once; the output is committed. CI never runs this.
 *
 *   node scripts/build-frost-normals.mjs                  # download + build
 *   node scripts/build-frost-normals.mjs --archive f.tgz  # build from a local copy
 *
 * Node 22's fetch ignores HTTPS_PROXY; behind a proxy, download with curl
 * first and pass --archive. The archive's SHA-256 is verified either way.
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

async function download(path) {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const argIdx = process.argv.indexOf('--archive');
  let archive = argIdx >= 0 ? process.argv[argIdx + 1] : null;
  if (!archive) {
    archive = resolve(process.env.TMPDIR ?? '/tmp', 'noaa-normals-annualseasonal.tar.gz');
    console.log(`downloading ${SOURCE_URL}`);
    await download(archive);
  }
  const digest = await sha256File(archive);
  if (digest !== SOURCE_SHA256) {
    throw new Error(`SHA-256 mismatch: expected ${SOURCE_SHA256}, got ${digest}`);
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

  const out = {
    source: SOURCE_URL,
    dataset: 'NOAA NCEI U.S. Climate Normals 1991-2020, annual/seasonal, by station',
    version: SOURCE_VERSION,
    sha256: SOURCE_SHA256,
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
      'frostFree?'
    ],
    dayOfYear: 'non-leap year, Jan 1 = 1',
    stations
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const body = JSON.stringify(out).replace(/\],\[/g, '],\n[');
  writeFileSync(OUT, body + '\n');
  const frostFree = stations.filter((s) => s.length > 13).length;
  console.log(
    `read ${seen} station files; wrote ${stations.length} rows (${frostFree} frost-free) to ${OUT} (${Buffer.byteLength(body)} bytes)`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
