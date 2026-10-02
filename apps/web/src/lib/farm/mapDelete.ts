/**
 * Deleting shapes from the farm map (#476). Pure and client-safe. What goes
 * depends on the object: an Area or block loses only its drawn outline and
 * keeps its records (the same thing right-click always did); a shade source
 * or a line or point is only a shape, so it is deleted.
 */

import { areaKindLabel, type AreaKind } from './areaKinds';
import { mapFeatureLabel, type MapFeatureKind } from './mapFeatures';
import { t } from '$lib/i18n';

export type MapShapeType = 'area' | 'block' | 'shade' | 'feature';

export interface MapShape {
  type: MapShapeType;
  id: string;
  name: string;
  /** "Garden", "Fence" and so on, for the confirm text. */
  kindLabel: string;
}

export function shapeKey(s: Pick<MapShape, 'type' | 'id'>): string {
  return `${s.type}:${s.id}`;
}

export function areaShape(
  a: { id: string; name: string; kind?: AreaKind | null },
  locale?: string | null
): MapShape {
  return {
    type: 'area',
    id: a.id,
    name: a.name,
    kindLabel: areaKindLabel(a.kind ?? 'field', locale)
  };
}

export function blockShape(b: { id: string; name: string }, locale?: string | null): MapShape {
  return { type: 'block', id: b.id, name: b.name, kindLabel: t(locale, 'farm.blockKind.block') };
}

export function shadeShape(s: { id: string; name: string }, locale?: string | null): MapShape {
  return { type: 'shade', id: s.id, name: s.name, kindLabel: t(locale, 'map.delete.shadeKind') };
}

export function featureShape(
  f: { id: string; name: string; kind: MapFeatureKind },
  locale?: string | null
): MapShape {
  return { type: 'feature', id: f.id, name: f.name, kindLabel: mapFeatureLabel(f.kind, locale) };
}

/** Adds the shape, or takes it out when it is already picked. */
export function toggleShape(selection: readonly MapShape[], shape: MapShape): MapShape[] {
  const key = shapeKey(shape);
  return selection.some((s) => shapeKey(s) === key)
    ? selection.filter((s) => shapeKey(s) !== key)
    : [...selection, shape];
}

export function isSelected(selection: readonly MapShape[], type: MapShapeType, id: string) {
  const key = shapeKey({ type, id });
  return selection.some((s) => shapeKey(s) === key);
}

export function deleteButtonLabel(count: number, locale?: string | null): string {
  return t(locale, 'map.delete.button', { count });
}

/** The one-line help under the map toolbar, worded for the device. */
export function deleteHint(touch: boolean, locale?: string | null): string {
  return t(locale, touch ? 'map.delete.hintTouch' : 'map.delete.hintMouse');
}

function displayName(s: MapShape): string {
  return s.name.trim() || s.kindLabel;
}

/** What happens to one shape, in plain words for the confirm dialog. */
export function describeDeletion(s: MapShape, locale?: string | null): string {
  const name = displayName(s);
  const kind = s.kindLabel.toLowerCase();
  switch (s.type) {
    case 'area':
      return t(locale, 'map.delete.area', { name, kind });
    case 'block':
      return t(locale, 'map.delete.block', { name });
    case 'shade':
      return t(locale, 'map.delete.shade', { name });
    case 'feature':
      return t(locale, 'map.delete.feature', { name, kind });
  }
}

export function confirmTitle(shapes: readonly MapShape[], locale?: string | null): string {
  return shapes.length === 1
    ? t(locale, 'map.delete.titleOne', { name: displayName(shapes[0]) })
    : t(locale, 'map.delete.titleMany', { count: shapes.length });
}

/** Extra line when a removed outline changes map-based checks. */
export function outlineWarning(shapes: readonly MapShape[]): string | null {
  return shapes.some((s) => s.type === 'area' || s.type === 'block')
    ? 'Without an outline, checks that use the map, like distance between crops and grazing on an Area, cannot see where it is until you draw it again.'
    : null;
}

export interface DeleteHandlers {
  area: (id: string) => Promise<unknown> | unknown;
  block: (id: string) => Promise<unknown> | unknown;
  shade?: (id: string) => Promise<unknown> | unknown;
  feature?: (id: string) => Promise<unknown> | unknown;
}

export interface DeleteOutcome {
  deleted: MapShape[];
  failed: Array<{ shape: MapShape; message: string }>;
}

/** Runs one delete per shape, in order, and keeps going past failures so
 *  the owner sees exactly which ones did not go. */
export async function deleteShapes(
  shapes: readonly MapShape[],
  handlers: DeleteHandlers,
  locale?: string | null
): Promise<DeleteOutcome> {
  const out: DeleteOutcome = { deleted: [], failed: [] };
  for (const shape of shapes) {
    const run = handlers[shape.type];
    if (!run) {
      out.failed.push({ shape, message: t(locale, 'map.delete.cannot') });
      continue;
    }
    try {
      await run(shape.id);
      out.deleted.push(shape);
    } catch (e) {
      out.failed.push({ shape, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
