/**
 * Claude's reading of the aerial photo, checked before anyone sees it (P-7).
 * Pure and client-safe. One bad item refuses the whole reading: a position
 * outside the photo, too many items, an unknown kind, or any text the spray
 * advice guard objects to. Nothing here trusts the model.
 */

import { asksForSprayAdvice, filterSprayAdvice } from '$lib/journal/photoHelp';
import { imageToLonLat, type PhotoExtent } from './geometry';
import type { LonLat, Obstacle, ObstacleKind } from './types';

export const AI_FEATURE_KINDS = [
  'tree',
  'tree-line',
  'building',
  'water',
  'pavement',
  'shadow',
  'bare-ground',
  'wet-area',
  'open-lawn',
  'other'
] as const;
export type AiFeatureKind = (typeof AI_FEATURE_KINDS)[number];

export const MAX_AI_FEATURES = 40;
export const MAX_AI_SPOTS = 3;
export const MAX_AI_NOTE = 120;
export const MAX_AI_REASON = 200;
export const MAX_AI_CAVEATS = 200;
export const MAX_AI_RADIUS = 0.5;
/** The whole answer is JSON with at most 40 short items. */
export const MAX_AI_ANSWER_CHARS = 9000;

// App defaults for shapes Claude gives without a size. A rough guide.
export const AI_MIN_RADIUS_M = 1.5;
export const AI_DEFAULT_RADIUS = 0.03;
export const AI_TREE_LINE_HALF_WIDTH_M = 4;
export const AI_PAVEMENT_HALF_WIDTH_M = 2;

export interface AiFeature {
  kind: AiFeatureKind;
  x: number;
  y: number;
  radius?: number;
  x2?: number;
  y2?: number;
  note?: string;
}

export interface AiSpot {
  x: number;
  y: number;
  reason: string;
}

export interface AiReading {
  features: AiFeature[];
  spots: AiSpot[];
  caveats?: string;
}

export type AiReadingRefusal =
  | 'not-json'
  | 'not-an-object'
  | 'unknown-field'
  | 'not-a-list'
  | 'too-many'
  | 'bad-kind'
  | 'bad-coordinate'
  | 'bad-size'
  | 'bad-text'
  | 'spray-text';

export type ParsedAiReading =
  { ok: true; reading: AiReading } | { ok: false; reason: AiReadingRefusal };

const KINDS: ReadonlySet<string> = new Set(AI_FEATURE_KINDS);
const TOP_KEYS = new Set(['features', 'spots', 'caveats']);
const FEATURE_KEYS = new Set(['kind', 'x', 'y', 'radius', 'x2', 'y2', 'note']);
const SPOT_KEYS = new Set(['x', 'y', 'reason']);

function unit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Text Claude wrote, or the reason it is refused. Product names, rates and
 *  anything else the photo-help guard treats as spray advice refuse it. */
function cleanText(
  raw: unknown,
  max: number,
  sprayTerms?: readonly string[]
): { text: string } | AiReadingRefusal {
  if (typeof raw !== 'string') return 'bad-text';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 1 || text.length > max) return 'bad-text';
  if (/[<>{}]/.test(text)) return 'bad-text';
  if (asksForSprayAdvice(text, sprayTerms) || filterSprayAdvice(text, sprayTerms).removed) {
    return 'spray-text';
  }
  return { text };
}

function oneFeature(raw: unknown, sprayTerms?: readonly string[]): AiFeature | AiReadingRefusal {
  if (!isObject(raw)) return 'not-an-object';
  if (Object.keys(raw).some((k) => !FEATURE_KEYS.has(k))) return 'unknown-field';
  if (typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return 'bad-kind';
  if (!unit(raw.x) || !unit(raw.y)) return 'bad-coordinate';
  const f: AiFeature = { kind: raw.kind as AiFeatureKind, x: raw.x, y: raw.y };
  if (raw.radius !== undefined && raw.radius !== null) {
    if (
      typeof raw.radius !== 'number' ||
      !Number.isFinite(raw.radius) ||
      raw.radius <= 0 ||
      raw.radius > MAX_AI_RADIUS
    ) {
      return 'bad-size';
    }
    f.radius = raw.radius;
  }
  const has2 = raw.x2 !== undefined && raw.x2 !== null;
  const hasY2 = raw.y2 !== undefined && raw.y2 !== null;
  if (has2 !== hasY2) return 'bad-coordinate';
  if (has2) {
    if (!unit(raw.x2) || !unit(raw.y2)) return 'bad-coordinate';
    f.x2 = raw.x2;
    f.y2 = raw.y2;
  }
  if (raw.note !== undefined && raw.note !== null && raw.note !== '') {
    const note = cleanText(raw.note, MAX_AI_NOTE, sprayTerms);
    if (typeof note === 'string') return note;
    f.note = note.text;
  }
  return f;
}

function oneSpot(raw: unknown, sprayTerms?: readonly string[]): AiSpot | AiReadingRefusal {
  if (!isObject(raw)) return 'not-an-object';
  if (Object.keys(raw).some((k) => !SPOT_KEYS.has(k))) return 'unknown-field';
  if (!unit(raw.x) || !unit(raw.y)) return 'bad-coordinate';
  const reason = cleanText(raw.reason, MAX_AI_REASON, sprayTerms);
  if (typeof reason === 'string') return reason;
  return { x: raw.x, y: raw.y, reason: reason.text };
}

/** The checked reading, or why all of it was refused. */
export function validateAiReading(raw: unknown, sprayTerms?: readonly string[]): ParsedAiReading {
  if (!isObject(raw)) return { ok: false, reason: 'not-an-object' };
  if (Object.keys(raw).some((k) => !TOP_KEYS.has(k))) return { ok: false, reason: 'unknown-field' };
  if (!Array.isArray(raw.features) || !Array.isArray(raw.spots)) {
    return { ok: false, reason: 'not-a-list' };
  }
  if (raw.features.length > MAX_AI_FEATURES || raw.spots.length > MAX_AI_SPOTS) {
    return { ok: false, reason: 'too-many' };
  }
  const features: AiFeature[] = [];
  for (const item of raw.features) {
    const f = oneFeature(item, sprayTerms);
    if (typeof f === 'string') return { ok: false, reason: f };
    features.push(f);
  }
  const spots: AiSpot[] = [];
  for (const item of raw.spots) {
    const s = oneSpot(item, sprayTerms);
    if (typeof s === 'string') return { ok: false, reason: s };
    spots.push(s);
  }
  const reading: AiReading = { features, spots };
  if (raw.caveats !== undefined && raw.caveats !== null && raw.caveats !== '') {
    const c = cleanText(raw.caveats, MAX_AI_CAVEATS, sprayTerms);
    if (typeof c === 'string') return { ok: false, reason: c };
    reading.caveats = c.text;
  }
  return { ok: true, reading };
}

/** Reads the model's text. Strict: the text must be one JSON object, with at
 *  most a code fence around it. Prose before or after refuses it. */
export function parseAiReading(text: string, sprayTerms?: readonly string[]): ParsedAiReading {
  if (typeof text !== 'string' || text.length > MAX_AI_ANSWER_CHARS) {
    return { ok: false, reason: 'not-json' };
  }
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!body.startsWith('{') || !body.endsWith('}')) return { ok: false, reason: 'not-json' };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  return validateAiReading(raw, sprayTerms);
}

const OBSTACLE_KIND: Partial<Record<AiFeatureKind, ObstacleKind>> = {
  tree: 'tree',
  'tree-line': 'tree-line',
  building: 'building',
  water: 'water',
  pavement: 'pavement'
};

/** What Claude saw, placed on the ground. Kinds that stand up or cannot be
 *  planted on become obstacles (`ai`, height unknown); the rest are notes. */
export interface SeenFeature {
  id: string;
  kind: AiFeatureKind;
  center: LonLat;
  note?: string;
  obstacle: Obstacle | null;
}

export function seenFeatures(reading: AiReading, extent: PhotoExtent): SeenFeature[] {
  return reading.features.map((f, i) => {
    const id = `ai${i + 1}`;
    const center = imageToLonLat(extent, f.x, f.y);
    const kind = OBSTACLE_KIND[f.kind];
    let obstacle: Obstacle | null = null;
    if (kind) {
      const line = f.x2 !== undefined && f.y2 !== undefined;
      const radiusM = Math.max(AI_MIN_RADIUS_M, (f.radius ?? AI_DEFAULT_RADIUS) * extent.groundM);
      obstacle = {
        id,
        kind,
        shape: line
          ? {
              type: 'line',
              points: [center, imageToLonLat(extent, f.x2 as number, f.y2 as number)],
              halfWidthM:
                kind === 'pavement'
                  ? AI_PAVEMENT_HALF_WIDTH_M
                  : f.radius !== undefined
                    ? radiusM
                    : AI_TREE_LINE_HALF_WIDTH_M
            }
          : { type: 'circle', center, radiusM },
        heightFt: null,
        ...(f.note ? { note: f.note } : {}),
        provenance: 'ai'
      };
    }
    return { id, kind: f.kind, center, ...(f.note ? { note: f.note } : {}), obstacle };
  });
}
