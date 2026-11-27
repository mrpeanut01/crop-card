import { SOIL_SOURCE_NAME, type DrainageClass, type SoilComponent, type SoilSurvey } from './types';

/**
 * Reads a Soil Data Access `JSON+COLUMNNAME` answer: `{ Table: [[column
 * names], [row], ...] }` with every value a string or null, one row per major
 * component joined to its top mineral horizon. A point outside the survey
 * answers `{}`.
 */

const DRAINAGE_WORDS: Record<string, DrainageClass> = {
  'excessively drained': 'excessively',
  'somewhat excessively drained': 'somewhat-excessively',
  'well drained': 'well',
  'moderately well drained': 'moderately-well',
  'somewhat poorly drained': 'somewhat-poorly',
  'poorly drained': 'poorly',
  'very poorly drained': 'very-poorly'
};

export function drainageClassFromWords(words: unknown): DrainageClass | null {
  if (typeof words !== 'string') return null;
  return DRAINAGE_WORDS[words.trim().toLowerCase()] ?? null;
}

type Row = Record<string, string | null>;

function tableRows(json: unknown): Row[] | null {
  let body = json;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const table = (body as { Table?: unknown }).Table;
  if (table === undefined) return Object.keys(body).length === 0 ? [] : null;
  if (!Array.isArray(table)) return null;
  if (table.length === 0) return [];
  const header = table[0];
  if (!Array.isArray(header) || header.some((h) => typeof h !== 'string')) return null;
  const rows: Row[] = [];
  for (const raw of table.slice(1)) {
    if (!Array.isArray(raw)) return null;
    const row: Row = {};
    header.forEach((name: string, i: number) => {
      const v: unknown = raw[i];
      row[name.toLowerCase()] =
        typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
    });
    rows.push(row);
  }
  return rows;
}

/** True when the answer is a well-formed "nothing here": `{}` or a table
 *  with no rows. A malformed answer is not empty; it is unreadable. */
export function isEmptySdaAnswer(json: unknown): boolean {
  const rows = tableRows(json);
  return rows !== null && rows.length === 0;
}

function text(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

function num(v: string | null | undefined, min = -Infinity, max = Infinity): number | null {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function hydric(v: string | null | undefined): boolean | null {
  const s = text(v)?.toLowerCase();
  return s === 'yes' ? true : s === 'no' ? false : null;
}

function component(row: Row): SoilComponent | null {
  const name = text(row.compname);
  if (name === null) return null;
  const low = num(row.ph1to1h2o_l, 0, 14);
  const typical = num(row.ph1to1h2o_r, 0, 14);
  const high = num(row.ph1to1h2o_h, 0, 14);
  return {
    name,
    percent: num(row.comppct_r, 0, 100),
    drainageClass: drainageClassFromWords(row.drainagecl),
    slopePct: num(row.slope_r, 0),
    hydric: hydric(row.hydricrating),
    surfaceTexture: text(row.texdesc),
    sandPct: num(row.sandtotal_r, 0, 100),
    siltPct: num(row.silttotal_r, 0, 100),
    clayPct: num(row.claytotal_r, 0, 100),
    organicMatterPct: num(row.om_r, 0, 100),
    ph: low === null && typical === null && high === null ? null : { low, typical, high }
  };
}

function hasSoilProperties(c: SoilComponent): boolean {
  return (
    c.drainageClass !== null ||
    c.surfaceTexture !== null ||
    c.sandPct !== null ||
    c.siltPct !== null ||
    c.clayPct !== null ||
    c.organicMatterPct !== null ||
    c.ph !== null
  );
}

/** The survey for the answer's map unit, or null when the answer is empty
 *  or cannot be read. Takes the parsed JSON or its text. Never throws. */
export function parseSdaTable(json: unknown, fetchedAt: number = Date.now()): SoilSurvey | null {
  try {
    const rows = tableRows(json);
    if (!rows || rows.length === 0) return null;
    const first = rows[0];
    const mapUnitKey = text(first.mukey);
    const mapUnitName = text(first.muname);
    if (mapUnitKey === null || mapUnitName === null) return null;

    const seen = new Set<string>();
    const components: SoilComponent[] = [];
    for (const row of rows) {
      if (text(row.mukey) !== mapUnitKey) continue;
      const c = component(row);
      if (!c) continue;
      const key = text(row.cokey) ?? `${c.name}:${c.percent}`;
      if (seen.has(key)) continue;
      seen.add(key);
      components.push(c);
    }
    components.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));

    const drainageClass = drainageClassFromWords(first.drclassdcd);
    const dominant = components[0];
    return {
      mapUnitKey,
      mapUnitSymbol: text(first.musym) ?? '',
      mapUnitName,
      farmlandClass: text(first.farmlndcl),
      drainageClass,
      slopePct: num(first.slopegradwta, 0),
      waterTableDepthCm: num(first.wtdepannmin, 0),
      bedrockDepthCm: num(first.brockdepmin, 0),
      hydrologicGroup: text(first.hydgrpdcd),
      floodFrequency: text(first.flodfreqdcd),
      availableWaterCm: num(first.aws0100wta, 0),
      components,
      notSoil: dominant ? !hasSoilProperties(dominant) : drainageClass === null,
      source: { name: SOIL_SOURCE_NAME, fetchedAt }
    };
  } catch {
    return null;
  }
}
