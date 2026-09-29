/**
 * Deleting shapes from the farm map (#476). Pure and client-safe. What goes
 * depends on the object: an Area or block loses only its drawn outline and
 * keeps its records (the same thing right-click always did); a shade source
 * or a line or point is only a shape, so it is deleted.
 */

import { AREA_KIND_LABELS, type AreaKind } from './areaKinds';
import { MAP_FEATURE_LABELS, type MapFeatureKind } from './mapFeatures';

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

export function areaShape(a: { id: string; name: string; kind?: AreaKind | null }): MapShape {
  return { type: 'area', id: a.id, name: a.name, kindLabel: AREA_KIND_LABELS[a.kind ?? 'field'] };
}

export function blockShape(b: { id: string; name: string }): MapShape {
  return { type: 'block', id: b.id, name: b.name, kindLabel: 'Block' };
}

export function shadeShape(s: { id: string; name: string }): MapShape {
  return { type: 'shade', id: s.id, name: s.name, kindLabel: 'Shade source' };
}

export function featureShape(f: { id: string; name: string; kind: MapFeatureKind }): MapShape {
  return { type: 'feature', id: f.id, name: f.name, kindLabel: MAP_FEATURE_LABELS[f.kind] };
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

export function deleteButtonLabel(count: number): string {
  return count === 1 ? 'Delete 1 shape' : `Delete ${count} shapes`;
}

/** The one-line help under the map toolbar, worded for the device. */
export function deleteHint(touch: boolean): string {
  return touch ? 'Long-press a shape to delete it.' : 'Right-click a shape to delete it.';
}

function displayName(s: MapShape): string {
  return s.name.trim() || s.kindLabel;
}

/** What happens to one shape, in plain words for the confirm dialog. */
export function describeDeletion(s: MapShape): string {
  const name = displayName(s);
  switch (s.type) {
    case 'area':
      return `The outline of ${name} (${s.kindLabel.toLowerCase()}) comes off the map. The Area and its records stay.`;
    case 'block':
      return `The outline of ${name} comes off the map. The block and its records stay.`;
    case 'shade':
      return `${name} (shade source) is deleted.`;
    case 'feature':
      return `${name} (${s.kindLabel.toLowerCase()}) is deleted.`;
  }
}

export function confirmTitle(shapes: readonly MapShape[]): string {
  return shapes.length === 1
    ? `Delete ${displayName(shapes[0])}?`
    : `Delete ${shapes.length} shapes?`;
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
  handlers: DeleteHandlers
): Promise<DeleteOutcome> {
  const out: DeleteOutcome = { deleted: [], failed: [] };
  for (const shape of shapes) {
    const run = handlers[shape.type];
    if (!run) {
      out.failed.push({ shape, message: 'This map cannot delete that here.' });
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
