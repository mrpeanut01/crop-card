/**
 * Typed Areas (Phase 30). The UI word "Area" is a `fields` row; its `kind`
 * picks the map color, the detail form and whether it opens in the garden
 * designer. Blocks inside an Area carry their own `kind` (a bed in a garden,
 * a row in an orchard). DB values are stable lowercase strings; display
 * labels live here so no screen spells "{kind} area".
 */

import { z } from 'zod';
import { haversineMeters } from '$lib/geo/area';

export const CROP_AREA_KINDS = ['field', 'garden', 'greenhouse', 'orchard', 'pasture'] as const;
export const OTHER_AREA_KINDS = ['barn', 'residence', 'natural_area', 'water', 'boundary'] as const;
export const AREA_KINDS = [...CROP_AREA_KINDS, ...OTHER_AREA_KINDS] as const;

export type CropAreaKind = (typeof CROP_AREA_KINDS)[number];
export type AreaKind = (typeof AREA_KINDS)[number];

export const DEFAULT_AREA_KIND: AreaKind = 'field';

export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  field: 'Field',
  garden: 'Garden',
  greenhouse: 'Greenhouse',
  orchard: 'Orchard',
  pasture: 'Pasture',
  barn: 'Barn',
  residence: 'House',
  natural_area: 'Woods / natural',
  water: 'Pond / water',
  boundary: 'Boundary'
};

export const DESIGNABLE_AREA_KINDS = ['garden', 'greenhouse'] as const;
export type DesignableAreaKind = (typeof DESIGNABLE_AREA_KINDS)[number];

export function isAreaKind(value: unknown): value is AreaKind {
  return typeof value === 'string' && (AREA_KINDS as readonly string[]).includes(value);
}

export function isCropBearing(kind: AreaKind): kind is CropAreaKind {
  return (CROP_AREA_KINDS as readonly string[]).includes(kind);
}

export function isDesignable(kind: AreaKind): kind is DesignableAreaKind {
  return (DESIGNABLE_AREA_KINDS as readonly string[]).includes(kind);
}

// ─── Kind-specific details (fields.details_json) ─────────────────────────

export const ORGANIC_STATUSES = ['non-organic', 'transitional', 'organic'] as const;
export const IRRIGATION_KINDS = ['none', 'hose', 'drip', 'sprinkler'] as const;
export const GREENHOUSE_STRUCTURES = ['glass', 'poly', 'high-tunnel', 'caterpillar'] as const;
export const PASTURE_USES = ['hay', 'graze', 'both'] as const;

const isoDate = z.iso.date('expected a real YYYY-MM-DD date');
const spacingFt = z.number().positive().max(200);

export const gardenDetailsSchema = z.strictObject({
  organicStatus: z.enum(ORGANIC_STATUSES).optional(),
  transitionDate: isoDate.optional(),
  irrigation: z.enum(IRRIGATION_KINDS).optional()
});

export const greenhouseDetailsSchema = z.strictObject({
  organicStatus: z.enum(ORGANIC_STATUSES).optional(),
  heated: z.boolean().optional(),
  supplementalLight: z.boolean().optional(),
  structure: z.enum(GREENHOUSE_STRUCTURES).optional()
});

export const orchardDetailsSchema = z.strictObject({
  rowSpacingFt: spacingFt.optional(),
  treeSpacingFt: spacingFt.optional()
});

export const pastureDetailsSchema = z.strictObject({
  use: z.enum(PASTURE_USES).optional()
});

export const barnDetailsSchema = z.strictObject({
  washPack: z.boolean().optional(),
  coldStorage: z.boolean().optional(),
  chemicalStorage: z.boolean().optional()
});

export const waterDetailsSchema = z.strictObject({
  usedForIrrigation: z.boolean().optional()
});

const emptyDetailsSchema = z.strictObject({});

export const AREA_DETAILS_SCHEMAS = {
  field: emptyDetailsSchema,
  garden: gardenDetailsSchema,
  greenhouse: greenhouseDetailsSchema,
  orchard: orchardDetailsSchema,
  pasture: pastureDetailsSchema,
  barn: barnDetailsSchema,
  residence: emptyDetailsSchema,
  natural_area: emptyDetailsSchema,
  water: waterDetailsSchema,
  boundary: emptyDetailsSchema
} as const satisfies Record<AreaKind, z.ZodType>;

export type AreaDetailsFor<K extends AreaKind> = z.infer<(typeof AREA_DETAILS_SCHEMAS)[K]>;
export type GardenDetails = z.infer<typeof gardenDetailsSchema>;
export type GreenhouseDetails = z.infer<typeof greenhouseDetailsSchema>;
export type OrchardDetails = z.infer<typeof orchardDetailsSchema>;
export type PastureDetails = z.infer<typeof pastureDetailsSchema>;
export type BarnDetails = z.infer<typeof barnDetailsSchema>;
export type WaterDetails = z.infer<typeof waterDetailsSchema>;

function variant<K extends AreaKind>(kind: K) {
  return z.object({
    kind: z.literal(kind),
    details: AREA_DETAILS_SCHEMAS[kind].nullable().optional()
  });
}

/** A kind together with its details; the union rejects details that don't
 *  belong to the kind (e.g. `heated` on a pasture). */
export const areaKindWithDetailsSchema = z.discriminatedUnion('kind', [
  variant('field'),
  variant('garden'),
  variant('greenhouse'),
  variant('orchard'),
  variant('pasture'),
  variant('barn'),
  variant('residence'),
  variant('natural_area'),
  variant('water'),
  variant('boundary')
]);

export type AreaKindWithDetails = z.infer<typeof areaKindWithDetailsSchema>;
/** Stored details are never `{}` (validation normalizes that to null), so
 *  the empty kinds contribute nothing here. */
export type AreaDetails =
  GardenDetails | GreenhouseDetails | OrchardDetails | PastureDetails | BarnDetails | WaterDetails;

export type DetailsResult =
  { ok: true; details: AreaDetails | null } | { ok: false; issues: z.ZodError['issues'] };

/** Validates `details` against `kind`. Empty objects normalize to null so a
 *  cleared form doesn't persist `{}`. */
export function validateAreaDetails(kind: AreaKind, details: unknown): DetailsResult {
  if (details === null || details === undefined) return { ok: true, details: null };
  const parsed = AREA_DETAILS_SCHEMAS[kind].safeParse(details);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  const clean = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as AreaDetails;
  return { ok: true, details: Object.keys(clean).length === 0 ? null : clean };
}

/** Reads stored `details_json`. Anything that no longer validates against
 *  the row's kind (a kind change, a hand-edited row) reads as null rather
 *  than leaking attributes from another kind. */
export function parseAreaDetails(kind: AreaKind, json: string | null | undefined) {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const res = validateAreaDetails(kind, raw);
  return res.ok ? res.details : null;
}

// ─── Blocks inside an Area ───────────────────────────────────────────────

export const BLOCK_KINDS = ['block', 'bed', 'row', 'container'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const DEFAULT_BLOCK_KIND: BlockKind = 'block';

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  block: 'Block',
  bed: 'Bed',
  row: 'Row',
  container: 'Container'
};

export const BED_STYLES = ['raised', 'in-ground', 'container', 'vertical'] as const;
export type BedStyle = (typeof BED_STYLES)[number];

export const BED_STYLE_LABELS: Record<BedStyle, string> = {
  raised: 'Raised',
  'in-ground': 'In-ground',
  container: 'Container',
  vertical: 'Vertical'
};

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && (BLOCK_KINDS as readonly string[]).includes(value);
}

/** Beds and containers are positioned on the designer's feet grid. */
export function usesDesignerLayout(kind: BlockKind): boolean {
  return kind === 'bed' || kind === 'container';
}

/** The block kinds that make sense inside an Area of this kind; the first
 *  entry is the default for new blocks there. */
export function blockKindsFor(areaKind: AreaKind): readonly BlockKind[] {
  switch (areaKind) {
    case 'garden':
    case 'greenhouse':
      return ['bed', 'container', 'row', 'block'];
    case 'orchard':
      return ['row', 'block'];
    case 'field':
    case 'pasture':
      return ['block', 'row'];
    default:
      return [];
  }
}

export function defaultBlockKindFor(areaKind: AreaKind): BlockKind {
  return blockKindsFor(areaKind)[0] ?? DEFAULT_BLOCK_KIND;
}

export const ROTATION_STEPS_DEG = [0, 90, 180, 270] as const;

/** Snaps any angle to the nearest 90° step in [0, 360). */
export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const step = Math.round(deg / 90) * 90;
  return ((step % 360) + 360) % 360;
}

// ─── Perimeter ───────────────────────────────────────────────────────────

const FT_PER_M = 3.280_839_895;

type Ring = Array<[number, number]>;

function outerRings(obj: unknown): Ring[] {
  const out: Ring[] = [];
  const visit = (geom: unknown) => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown };
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      if (Array.isArray(g.coordinates[0])) out.push(g.coordinates[0] as Ring);
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates as unknown[][]) {
        if (Array.isArray(poly?.[0])) out.push(poly[0] as Ring);
      }
    }
  };
  if (obj && typeof obj === 'object') {
    const root = obj as { type?: string; geometry?: unknown; features?: unknown };
    if (root.type === 'Feature') visit(root.geometry);
    else if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
      for (const f of root.features) visit((f as { geometry?: unknown })?.geometry);
    } else visit(obj);
  }
  return out;
}

function validPoint(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

/** Sum of every outer ring's length in feet, or null when the GeoJSON has
 *  no usable polygon. Holes are not boundary you walk, so they're skipped. */
export function perimeterFtFromGeojson(geojson: string | null | undefined): number | null {
  if (!geojson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  let meters = 0;
  let rings = 0;
  for (const ring of outerRings(parsed)) {
    if (ring.length < 4 || !ring.every(validPoint)) continue;
    for (let i = 0; i < ring.length - 1; i++) meters += haversineMeters(ring[i], ring[i + 1]);
    rings++;
  }
  if (rings === 0 || !(meters > 0)) return null;
  return round1(meters * FT_PER_M);
}

export function perimeterFtFromDimensions(
  widthFt: number | null | undefined,
  lengthFt: number | null | undefined
): number | null {
  if (widthFt == null || lengthFt == null) return null;
  if (!(widthFt > 0) || !(lengthFt > 0)) return null;
  return round1(2 * (widthFt + lengthFt));
}

/** Drawn geometry wins over sketch dimensions, like acres. */
export function perimeterFtFor(input: {
  geometryGeojson?: string | null;
  widthFt?: number | null;
  lengthFt?: number | null;
}): number | null {
  return (
    perimeterFtFromGeojson(input.geometryGeojson) ??
    perimeterFtFromDimensions(input.widthFt, input.lengthFt)
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
