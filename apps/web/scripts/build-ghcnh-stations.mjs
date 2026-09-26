#!/usr/bin/env node
/**
 * Builds apps/web/src/lib/server/stations/ghcnh-stations-us.json: the U.S. stations
 * in NOAA NCEI's Global Historical Climatology Network hourly (GHCNh) station
 * list that carry an ICAO identifier (airport ASOS/AWOS sites, which report
 * hourly and also appear in the NWS observations API). Public domain
 * (17 U.S.C. §105), mirrored on NOAA Open Data Dissemination (AWS noaa-ghcnh-pds).
 * Run by hand; the output is committed. CI never runs this.
 *
 *   node scripts/build-ghcnh-stations.mjs               # download + build
 *   node scripts/build-ghcnh-stations.mjs --csv f.csv   # build from a local copy
 *
 * NCEI replaces the list in place, so a newer copy fails the SHA-256 check.
 * Bump SOURCE_SHA256 / SOURCE_VERSION deliberately when refreshing.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_URL =
  'https://noaa-ghcnh-pds.s3.amazonaws.com/hourly/doc/ghcnh-station-list.csv';
export const SOURCE_VERSION = 'Last-Modified 2026-09-16T08:43:00Z';
export const SOURCE_SHA256 = '812ea50bd5efd1b9cc09d5800c55825b3d43b3c5aa75ab17b2848f43b1bfaaef';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/lib/server/stations/ghcnh-stations-us.json');

/** Minimal CSV line splitter (the list quotes nothing today, but tolerate it). */
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

export function buildStations(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]);
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`missing column ${name}`);
    return i;
  };
  const iId = col('GHCN_ID');
  const iLat = col('LATITUDE');
  const iLon = col('LONGITUDE');
  const iName = col('NAME');
  const iIcao = col('ICAO');
  const iIso = col('ISO_CODE');
  const seen = new Set();
  const stations = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const icao = (f[iIcao] ?? '').trim();
    if ((f[iIso] ?? '').trim() !== 'US' || !/^[A-Z0-9]{4}$/.test(icao)) continue;
    const id = f[iId].trim();
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || seen.has(id)) continue;
    seen.add(id);
    stations.push([id, icao, lat, lon, f[iName].trim().replace(/\s+/g, ' ')]);
  }
  stations.sort((a, b) => a[0].localeCompare(b[0]));
  return stations;
}

async function main() {
  const argIdx = process.argv.indexOf('--csv');
  let buf;
  if (argIdx >= 0) {
    buf = readFileSync(process.argv[argIdx + 1]);
  } else {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) {
    throw new Error(`SHA-256 mismatch: got ${sha}, expected ${SOURCE_SHA256}`);
  }
  const stations = buildStations(buf.toString('utf8'));
  mkdirSync(dirname(OUT), { recursive: true });
  const head = JSON.stringify({
    source: SOURCE_URL,
    version: SOURCE_VERSION,
    sha256: SOURCE_SHA256,
    columns: ['ghcnId', 'icao', 'lat', 'lon', 'name']
  }).slice(0, -1);
  const rows = stations.map((s) => JSON.stringify(s)).join(',\n');
  writeFileSync(OUT, `${head},"stations":[\n${rows}\n]}\n`);
  console.log(`wrote ${stations.length} stations → ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
