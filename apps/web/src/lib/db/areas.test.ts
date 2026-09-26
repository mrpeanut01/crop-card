import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createArea, getArea, listAreas, updateArea } from './areas';
import * as fieldsRepo from './fields';
import { createBlock, getBlock, listBlocks, updateBlock } from './blocks';

function withOwner<T>(fn: () => T): T {
  const id = `areas-test-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return runWithTenant(id, fn);
}

describe('areas repo', () => {
  it('aliases the fields repo', () => {
    expect(listAreas).toBe(fieldsRepo.listFields);
    expect(createArea).toBe(fieldsRepo.createField);
  });

  it('defaults existing-style creates to kind field with no details', () =>
    withOwner(() => {
      const f = createArea({ name: 'Back 40' });
      expect(f.kind).toBe('field');
      expect(f.details).toBeNull();
      expect(f.perimeterFt).toBeUndefined();
    }));

  it('stores kind, details and a perimeter from sketch dimensions', () =>
    withOwner(() => {
      const g = createArea({
        name: 'Kitchen Garden',
        kind: 'garden',
        details: { irrigation: 'drip' },
        widthFt: 30,
        lengthFt: 40
      });
      expect(g.kind).toBe('garden');
      expect(g.details).toEqual({ irrigation: 'drip' });
      expect(g.perimeterFt).toBe(140);
      expect(getArea(g.id)).toMatchObject({ kind: 'garden', perimeterFt: 140 });
    }));

  it('recomputes the perimeter when one dimension changes', () =>
    withOwner(() => {
      const g = createArea({ name: 'G', kind: 'garden', widthFt: 30, lengthFt: 40 });
      expect(updateArea(g.id, { widthFt: 10 })?.perimeterFt).toBe(100);
      expect(updateArea(g.id, { widthFt: null })?.perimeterFt).toBeUndefined();
    }));

  it('drops details that do not fit a new kind unless new details are sent', () =>
    withOwner(() => {
      const a = createArea({ name: 'A', kind: 'pasture', details: { use: 'hay' } });
      const kept = updateArea(a.id, { name: 'A2' });
      expect(kept?.details).toEqual({ use: 'hay' });
      const moved = updateArea(a.id, { kind: 'barn' });
      expect(moved?.kind).toBe('barn');
      expect(moved?.details).toBeNull();
      const withNew = updateArea(a.id, { kind: 'water', details: { usedForIrrigation: true } });
      expect(withNew?.details).toEqual({ usedForIrrigation: true });
      expect(updateArea(a.id, { details: null })?.details).toBeNull();
    }));

  it('filters by kind', () =>
    withOwner(() => {
      createArea({ name: 'F', kind: 'field' });
      const g = createArea({ name: 'G', kind: 'garden' });
      const h = createArea({ name: 'H', kind: 'greenhouse' });
      expect(
        listAreas({ kinds: ['garden', 'greenhouse'] })
          .map((a) => a.id)
          .sort()
      ).toEqual([g.id, h.id].sort());
      expect(listAreas({ kinds: [] })).toEqual([]);
      expect(listAreas()).toHaveLength(3);
    }));
});

describe('blocks repo: kind and layout', () => {
  it('defaults to kind block with no layout', () =>
    withOwner(() => {
      const b = createBlock({ name: 'North' });
      expect(b.kind).toBe('block');
      expect(b.xFt).toBeUndefined();
      expect(b.bedStyle).toBeUndefined();
    }));

  it('stores and clears bed layout', () =>
    withOwner(() => {
      const g = createArea({ name: 'G', kind: 'garden', widthFt: 20, lengthFt: 20 });
      const b = createBlock({
        name: 'Bed 1',
        fieldId: g.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 3.5,
        rotationDeg: 90,
        bedStyle: 'raised'
      });
      expect(getBlock(b.id)).toMatchObject({
        kind: 'bed',
        xFt: 2,
        yFt: 3.5,
        rotationDeg: 90,
        bedStyle: 'raised'
      });
      const moved = updateBlock(b.id, { xFt: 6, rotationDeg: 0, bedStyle: null });
      expect(moved).toMatchObject({ xFt: 6, yFt: 3.5, rotationDeg: 0 });
      expect(moved?.bedStyle).toBeUndefined();
    }));

  it('filters by kind', () =>
    withOwner(() => {
      createBlock({ name: 'B' });
      const bed = createBlock({ name: 'Bed', kind: 'bed' });
      const pot = createBlock({ name: 'Pot', kind: 'container' });
      expect(
        listBlocks({ kinds: ['bed', 'container'] })
          .map((b) => b.id)
          .sort()
      ).toEqual([bed.id, pot.id].sort());
      expect(listBlocks({ kinds: [] })).toEqual([]);
    }));
});
