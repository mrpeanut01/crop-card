import { describe, expect, it, vi } from 'vitest';
import { NEW_AREA, planSpot, saveSpot } from './spot';
import type { SetupArea } from './types';

const AREAS: SetupArea[] = [
  { id: 'a-garden', name: 'Kitchen Garden', kind: 'garden' },
  { id: 'a-field', name: 'Home Field', kind: 'field' }
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('planSpot', () => {
  it('creates a new Area of the chosen kind with a matching block', () => {
    const plan = planSpot({ name: '  Back bed ', areaId: NEW_AREA, kind: 'garden' }, AREAS);
    expect(plan).toEqual({
      ok: true,
      area: { create: { name: 'Back bed', kind: 'garden' } },
      block: { name: 'Back bed', kind: 'bed' }
    });
  });

  it('puts a spot inside an existing Area using that Area kind default', () => {
    expect(planSpot({ name: 'Bed 4', areaId: 'a-garden', kind: 'field' }, AREAS)).toMatchObject({
      ok: true,
      area: { id: 'a-garden' },
      block: { kind: 'bed' }
    });
    expect(planSpot({ name: 'North 10', areaId: 'a-field', kind: 'garden' }, AREAS)).toMatchObject({
      ok: true,
      area: { id: 'a-field' },
      block: { kind: 'block' }
    });
  });

  it('asks for a name', () => {
    expect(planSpot({ name: '   ', areaId: NEW_AREA, kind: 'field' }, AREAS)).toEqual({
      ok: false,
      error: 'Give it a name first.'
    });
  });

  it('rejects an Area that is not in the list', () => {
    const plan = planSpot({ name: 'X', areaId: 'someone-elses', kind: 'field' }, AREAS);
    expect(plan.ok).toBe(false);
  });

  it('rejects a non crop-bearing kind for a new Area', () => {
    const plan = planSpot(
      { name: 'Barn', areaId: NEW_AREA, kind: 'barn' as unknown as 'field' },
      AREAS
    );
    expect(plan.ok).toBe(false);
  });
});

describe('saveSpot', () => {
  it('creates the Area, then the block inside it, through the existing endpoints', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url) === '/api/fields') return jsonResponse(201, { field: { id: 'f1' } });
      return jsonResponse(201, { block: { id: 'b1', name: 'Back bed' } });
    });
    const plan = planSpot({ name: 'Back bed', areaId: NEW_AREA, kind: 'garden' }, AREAS);
    if (!plan.ok) throw new Error('plan');
    const out = await saveSpot(plan, fetchFn as unknown as typeof fetch);
    expect(out).toEqual({
      ok: true,
      result: { blockId: 'b1', blockName: 'Back bed', areaId: 'f1' }
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string)).toEqual({
      name: 'Back bed',
      kind: 'garden'
    });
    expect(JSON.parse(fetchFn.mock.calls[1][1]!.body as string)).toEqual({
      name: 'Back bed',
      fieldId: 'f1',
      kind: 'bed'
    });
  });

  it('only creates the block for an existing Area', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) =>
      jsonResponse(201, { block: { id: 'b2', name: 'Bed 4' } })
    );
    const plan = planSpot({ name: 'Bed 4', areaId: 'a-garden', kind: 'field' }, AREAS);
    if (!plan.ok) throw new Error('plan');
    const out = await saveSpot(plan, fetchFn as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0][0]).toBe('/api/blocks');
  });

  it('explains a 403 in plain words', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { message: 'owner role required' }));
    const plan = planSpot({ name: 'Bed 4', areaId: 'a-garden', kind: 'field' }, AREAS);
    if (!plan.ok) throw new Error('plan');
    const out = await saveSpot(plan, fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, error: 'Only the farm owner can add places.' });
  });
});
