#!/usr/bin/env node
/**
 * Builds apps/web/src/lib/climate/data/frost-normals-us.json from the NOAA
 * NCEI U.S. Climate Normals 1991-2020 annual/seasonal archive (public domain,
 * 17 U.S.C. §105), mirrored on NOAA Open Data Dissemination (AWS
 * noaa-normals-pds), plus each station's mean annual extreme minimum
 * temperature over 1991-2020 from GHCN-Daily (AWS noaa-ghcn-pds, also public
 * domain). Run once; the output is committed. CI never runs this.
 *
 *   node scripts/build-frost-normals.mjs                  # download + build
 *   node scripts/build-frost-normals.mjs --archive f.tgz --ghcn-dir dir/
 *
 * Node 22's fetch ignores HTTPS_PROXY; behind a proxy, download with curl
 * first and pass --archive and --ghcn-dir (holding 1991.csv.gz .. 2020.csv.gz
 * from csv.gz/by_year/). Every file's SHA-256 is verified either way.
 *
 * GHCN-Daily's by_year files are regenerated daily, so the pinned hashes are
 * the bytes retrieved for GHCN-Daily 3.34-upd-2026092418. A rebuild needs
 * those bytes, or a deliberate re-pin with --repin-ghcn (prints new hashes).
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

export const GHCN_BASE_URL = 'https://noaa-ghcn-pds.s3.amazonaws.com/csv.gz/by_year/';
export const GHCN_VERSION = '3.34-upd-2026092418';
export const GHCN_FIRST_YEAR = 1991;
export const GHCN_LAST_YEAR = 2020;
export const GHCN_SHA256 = {
  1991: '6bba0f18ad50c5565667825553577f382d087c37a1cb584bf038b79afebd1391',
  1992: '5fb1589f4b0b8f792ef8f1e183cb3826e5a51f96da43c341d874389e055e1f1b',
  1993: 'f5073874b71f42dfbad88fa2b624bde6de5add11ac43530493000e743d48b693',
  1994: 'f698cd97f319ca87dcca9f345e61192011472eda09fefb1f2b807c6c71f413e8',
  1995: '49a121844cba455e404a4c1b77c8b799821e100cd4127d3ec7f51c17574e52ea',
  1996: '29072a1e560d974cb720b0dcc75340abae73c5fbf710baca05aee5c3f14f13a6',
  1997: '247acf4f22631e772c22bb35c7419f131f22395393b4c2108617c5c36a08d789',
  1998: '9942fcfa3ef718c9a8c7244941426a468b37f0b88f2159615ed9183f2648046d',
  1999: 'f03472eb945573900466c5d9efb8052f8d7c3f3f520e4c56c416a1595610a719',
  2000: '5faf442a07f4f529dbff4eacb45cb7f6fddb62d870b723e3a31078adb821de44',
  2001: 'fbd63eb3237335a5e47b57b6456ee271702a0d379562b846f88c09b8e215b943',
  2002: 'a2dce74a3fa71a636df54a305f6deb6bbb7cc177cabca84262bdc44a2671db5d',
  2003: '849e0edb20783c1f1b6b2e61d3e52d9f427f258ab575d26631e7de0c22a35236',
  2004: '16aba1df5dca4266fe8ef57d2e8283af391cba1bf3b46dd211328ffde5725601',
  2005: '6ee50fa640f4e97fe97a0a387b6d0fc3ec9037387e23ebd66b60e7231c8b76d0',
  2006: '7ee7da4e2f07322d0f8fc283c0fdaa8a401757bcfc367aa8f78a767d78938bb6',
  2007: 'eb0e3047558e0a3e506700797c3f6f94c29e3caeb5e2a0aa76cd5b4b596038e7',
  2008: 'ed94322ef1cd91ffddf91d2ed3febc84647027e5f60e48f7a1ece90cf9f537c4',
  2009: '5b659aed3a018962dbd6aaf4bbf24d7b826f4f1629085f1d1fd6090dd9a5c6e2',
  2010: 'e3618437e583103bbc4c4057bfef9aaf888e2e073491ab93bdd26c549edc0aa5',
  2011: 'b1c0d303d3d0c631cf3f9e9f1c75c032d295666fb3578c69909b6115979d7873',
  2012: '128956b61ee4f4faab1162d153b0534db37e850cd24c5bb3eccbdfbcbe425232',
  2013: '769301978b0e0fa2c871a7c90713431e2d3e3ebded156b52e70e0c3e3b9ce64f',
  2014: '6701f34cc05023707fc729ff3e1a62389cc8ef5f667c0ece3044114eec693245',
  2015: '0cb4b043be3d9e7fee2a0cbf792dc6206cfb37a8f283c8c5bc8ec2bc79c2e2c7',
  2016: 'fafd6858a705f735dbdff3d3b65bac11ff5812e94dac1e79c74c7f1dc019c0c4',
  2017: '7cfa705d59c1894c68c11ed247a761215db618cfe99f51daabd7b32ee4f93ceb',
  2018: 'f697792835831dc41e4e36240d7efaa0ffe4904870905aed8ab4a5b87d8c8690',
  2019: '8f875e4cbd7ab3f557fdc52c833eb707c5d66165e9c16277d0c585aff8d8edf4',
  2020: 'c4b6c34f1c91b7dd78617439a8cef00eec905f2a50dab1206342578e1c0f05d0'
};

/** A year counts toward the mean when each of the three coldest months has at
 *  least this many QC-clean TMIN days. */
export const MIN_DAYS_PER_COLD_MONTH = 25;
/** A station needs this many counted years (of 30) to get an extremeMinF. */
export const MIN_YEARS_FOR_EXTREME = 15;

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

const YEARS = GHCN_LAST_YEAR - GHCN_FIRST_YEAR + 1;
const NORTH_COLD = { 12: 0, 1: 1, 2: 2 };
const SOUTH_COLD = { 6: 0, 7: 1, 8: 2 };
const NO_MIN = 32767;

/** Per-station yearly minimum TMIN (tenths of °C) and cold-month day counts.
 *  `southern` holds ids south of the equator, whose cold months are Jun-Aug. */
export function newExtremeAccumulator(stationIds, southern = new Set()) {
  const stations = new Map();
  for (const id of stationIds) {
    stations.set(id, {
      cold: southern.has(id) ? SOUTH_COLD : NORTH_COLD,
      min: new Int16Array(YEARS).fill(NO_MIN),
      days: new Uint8Array(YEARS * 3)
    });
  }
  return { stations };
}

/** One GHCN-Daily by_year line: `ID,YYYYMMDD,ELEMENT,VALUE,MFLAG,QFLAG,SFLAG,OBSTIME`.
 *  Only TMIN values with a blank quality flag count. */
export function accumulateGhcnLine(acc, line) {
  if (line.length < 26 || !line.startsWith('TMIN', 21)) return;
  const st = acc.stations.get(line.slice(0, 11));
  if (!st) return;
  const parts = line.split(',');
  if (parts.length < 6 || parts[5] !== '') return;
  const value = Number(parts[3]);
  if (!Number.isInteger(value) || value < -900 || value > 700) return;
  const year = Number(parts[1].slice(0, 4));
  const month = Number(parts[1].slice(4, 6));
  const y = year - GHCN_FIRST_YEAR;
  if (y < 0 || y >= YEARS) return;
  if (value < st.min[y]) st.min[y] = value;
  const slot = st.cold[month];
  if (slot !== undefined && st.days[y * 3 + slot] < 255) st.days[y * 3 + slot]++;
}

/** Mean of the counted years' minimum TMIN, in °F to one decimal, or null
 *  when fewer than MIN_YEARS_FOR_EXTREME years are complete. */
export function extremeMinF(acc, id) {
  const st = acc.stations.get(id);
  if (!st) return null;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < YEARS; y++) {
    if (st.min[y] === NO_MIN) continue;
    let complete = true;
    for (let k = 0; k < 3; k++) {
      if (st.days[y * 3 + k] < MIN_DAYS_PER_COLD_MONTH) complete = false;
    }
    if (!complete) continue;
    sum += st.min[y];
    n++;
  }
  if (n < MIN_YEARS_FOR_EXTREME) return null;
  const f = ((sum / n / 10) * 9) / 5 + 32;
  return Math.round(f * 10) / 10;
}

export async function accumulateGhcnFile(acc, path) {
  let rest = '';
  const stream = createReadStream(path).pipe(createGunzip());
  stream.setEncoding('latin1');
  for await (const chunk of stream) {
    const text = rest + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      accumulateGhcnLine(acc, text.slice(start, nl));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  if (rest) accumulateGhcnLine(acc, rest);
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

async function download(path, url = SOURCE_URL) {
  const res = await fetch(url);
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

  const ghcnIdx = process.argv.indexOf('--ghcn-dir');
  const repin = process.argv.includes('--repin-ghcn');
  let ghcnDir = ghcnIdx >= 0 ? process.argv[ghcnIdx + 1] : null;
  if (!ghcnDir) {
    ghcnDir = resolve(process.env.TMPDIR ?? '/tmp', 'ghcnd-by-year');
    mkdirSync(ghcnDir, { recursive: true });
    for (let year = GHCN_FIRST_YEAR; year <= GHCN_LAST_YEAR; year++) {
      console.log(`downloading GHCN-Daily ${year}`);
      await download(resolve(ghcnDir, `${year}.csv.gz`), `${GHCN_BASE_URL}${year}.csv.gz`);
    }
  }
  const ghcnFiles = [];
  for (let year = GHCN_FIRST_YEAR; year <= GHCN_LAST_YEAR; year++) {
    const path = resolve(ghcnDir, `${year}.csv.gz`);
    const got = await sha256File(path);
    if (repin) console.log(`  ${year}: '${got}',`);
    else if (got !== GHCN_SHA256[year]) {
      throw new Error(`GHCN ${year} SHA-256 mismatch: expected ${GHCN_SHA256[year]}, got ${got}`);
    }
    ghcnFiles.push(path);
  }
  if (repin) return;

  const stations = [];
  let seen = 0;
  for await (const entry of tarEntries(createReadStream(archive).pipe(createGunzip()))) {
    if (!entry.name.endsWith('.csv')) continue;
    seen++;
    const row = stationRow(entry.body.toString('utf8'));
    if (row) stations.push(row);
  }
  stations.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const acc = newExtremeAccumulator(
    stations.map((r) => r[0]),
    new Set(stations.filter((r) => r[2] < 0).map((r) => r[0]))
  );
  for (const path of ghcnFiles) {
    console.log(`reading ${path}`);
    await accumulateGhcnFile(acc, path);
  }
  let withExtreme = 0;
  for (const row of stations) {
    const f = extremeMinF(acc, row[0]);
    if (f === null) continue;
    if (row.length === 13) row.push(0);
    row.push(f);
    withExtreme++;
  }

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
      'frostFree?',
      'extremeMinF?'
    ],
    dayOfYear: 'non-leap year, Jan 1 = 1',
    extremeMin: {
      source: `${GHCN_BASE_URL}{${GHCN_FIRST_YEAR}..${GHCN_LAST_YEAR}}.csv.gz`,
      dataset: 'NOAA NCEI GHCN-Daily, by year',
      version: GHCN_VERSION,
      sha256: GHCN_SHA256,
      method: `Mean of each year's lowest QC-clean TMIN, ${GHCN_FIRST_YEAR}-${GHCN_LAST_YEAR}; a year counts with at least ${MIN_DAYS_PER_COLD_MONTH} days in each of Dec, Jan and Feb (Jun, Jul and Aug south of the equator), and a station needs ${MIN_YEARS_FOR_EXTREME} counted years.`,
      license: 'US Government work, public domain (17 U.S.C. §105)'
    },
    stations
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const body = JSON.stringify(out).replace(/\],\[/g, '],\n[');
  writeFileSync(OUT, body + '\n');
  const frostFree = stations.filter((s) => s[13] === 1).length;
  console.log(
    `read ${seen} station files; wrote ${stations.length} rows (${frostFree} frost-free, ${withExtreme} with extremeMinF) to ${OUT} (${Buffer.byteLength(body)} bytes)`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
