/**
 * External shade-source repo. Shade sources are non-crop tall features
 * (tree rows, hedges, buildings, fences) that cast shadows on adjacent
 * blocks. Modelled with the same height + opacity inputs as shade-casting
 * crops, plus a deciduous canopy gate.
 *
 * The shade engine (`apps/web/src/lib/calendar/shadeModel.ts`) consumes
 * these alongside crop emitters when projecting shadow impact onto blocks.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { shadeSources } from './schema';

export type ShadeSourceKind =
  | 'tree-row'
  | 'tree-grove'
  | 'tree-single'
  | 'hedge'
  | 'building'
  | 'fence'
  | 'structure'
  | 'other';

export interface ShadeSource {
  id: string;
  name: string;
  kind: ShadeSourceKind;
  geometryGeojson?: string;
  fieldId?: string;
  heightFt: number;
  opacity: number;
  isDeciduous: boolean;
  /** Day-of-year (1-366) when leaves emerge — only used when isDeciduous. */
  leafOnDayOfYear: number;
  /** Day-of-year (1-366) when leaves drop — only used when isDeciduous. */
  leafOffDayOfYear: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

function rowToShadeSource(row: typeof shadeSources.$inferSelect): ShadeSource {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ShadeSourceKind,
    geometryGeojson: row.geometryGeojson ?? undefined,
    fieldId: row.fieldId ?? undefined,
    heightFt: row.heightFt,
    opacity: row.opacity,
    isDeciduous: row.isDeciduous,
    leafOnDayOfYear: row.leafOnDayOfYear,
    leafOffDayOfYear: row.leafOffDayOfYear,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : Number(row.updatedAt)
  };
}

export interface CreateShadeSourceInput {
  name: string;
  kind?: ShadeSourceKind;
  geometryGeojson?: string;
  fieldId?: string;
  heightFt: number;
  opacity?: number;
  isDeciduous?: boolean;
  leafOnDayOfYear?: number;
  leafOffDayOfYear?: number;
  notes?: string;
}

export function createShadeSource(input: CreateShadeSourceInput): ShadeSource {
  const id = randomUUID();
  const now = new Date(Date.now());
  const inserted = db
    .insert(shadeSources)
    .values({
      id,
      name: input.name,
      kind: input.kind ?? 'tree-row',
      geometryGeojson: input.geometryGeojson ?? null,
      fieldId: input.fieldId ?? null,
      heightFt: input.heightFt,
      opacity: input.opacity ?? 0.7,
      isDeciduous: input.isDeciduous ?? false,
      leafOnDayOfYear: input.leafOnDayOfYear ?? 105,
      leafOffDayOfYear: input.leafOffDayOfYear ?? 305,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return rowToShadeSource(inserted);
}

export function listShadeSources(): ShadeSource[] {
  return db.select().from(shadeSources).all().map(rowToShadeSource);
}

export function getShadeSource(id: string): ShadeSource | undefined {
  const row = db.select().from(shadeSources).where(eq(shadeSources.id, id)).get();
  return row ? rowToShadeSource(row) : undefined;
}

export interface UpdateShadeSourceInput {
  name?: string;
  kind?: ShadeSourceKind;
  geometryGeojson?: string | null;
  fieldId?: string | null;
  heightFt?: number;
  opacity?: number;
  isDeciduous?: boolean;
  leafOnDayOfYear?: number;
  leafOffDayOfYear?: number;
  notes?: string | null;
}

export function updateShadeSource(id: string, patch: UpdateShadeSourceInput): ShadeSource | undefined {
  const set: Record<string, unknown> = { updatedAt: new Date(Date.now()) };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.geometryGeojson !== undefined) set.geometryGeojson = patch.geometryGeojson;
  if (patch.fieldId !== undefined) set.fieldId = patch.fieldId;
  if (patch.heightFt !== undefined) set.heightFt = patch.heightFt;
  if (patch.opacity !== undefined) set.opacity = patch.opacity;
  if (patch.isDeciduous !== undefined) set.isDeciduous = patch.isDeciduous;
  if (patch.leafOnDayOfYear !== undefined) set.leafOnDayOfYear = patch.leafOnDayOfYear;
  if (patch.leafOffDayOfYear !== undefined) set.leafOffDayOfYear = patch.leafOffDayOfYear;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const updated = db.update(shadeSources).set(set).where(eq(shadeSources.id, id)).returning().get();
  return updated ? rowToShadeSource(updated) : undefined;
}

export function deleteShadeSource(id: string): boolean {
  const result = db.delete(shadeSources).where(eq(shadeSources.id, id)).run();
  return result.changes > 0;
}
