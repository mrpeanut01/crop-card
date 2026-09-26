import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

/**
 * Phase 30E data track: placing plantings in a garden bed, moving their
 * date, and "Fill this bed" with no Anthropic key. Runs on a throwaway
 * Owner so the demo tenant other specs read stays untouched.
 */

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function send<T>(page: Page, method: 'post' | 'patch', url: string, data: unknown) {
  const res = await page.request[method](url, {
    data: data as Record<string, unknown>,
    headers: { origin: origin(page) }
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function freshOwner(page: Page): Promise<void> {
  const email = `garden-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
  const signin = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  expect(((await signin.json()) as { location?: string }).location).toBe('/onboarding');
  const onboard = await page.request.post('/onboarding?/farm', {
    form: { farmName: `Garden Farm ${Date.now()}`, planningYear: String(new Date().getFullYear()) },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  expect(((await onboard.json()) as { type?: string }).type).toBe('redirect');
}

test('garden bed plantings: place, recount, re-date and fill with no key', async ({ page }) => {
  await freshOwner(page);
  const year = new Date().getFullYear() + 1;

  const area = await send<{ field: { id: string } }>(page, 'post', '/api/fields', {
    name: 'Kitchen Garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  expect(area.status).toBe(201);
  const bed = await send<{ block: { id: string } }>(page, 'post', '/api/blocks', {
    name: 'Bed 1',
    fieldId: area.body.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0
  });
  expect(bed.status).toBe(201);
  const bedId = bed.body.block.id;

  const apr1 = Date.UTC(year, 3, 1);
  const placed = await send<{
    planting: { id: string };
    placed: { footprint: unknown; plantCount: number; plantCountProvenance: string };
  }>(page, 'post', `/api/blocks/${bedId}/plantings`, {
    cropPluginId: 'lettuce-black-seeded-simpson',
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
    spacingPattern: 'square'
  });
  expect(placed.status).toBe(201);
  expect(placed.body.placed).toMatchObject({
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
    plantCount: 24,
    plantCountProvenance: 'data'
  });
  const cropId = placed.body.planting.id;

  const outside = await send<{ code: string }>(page, 'patch', `/api/crops/${cropId}`, {
    action: 'set-placement',
    blockId: bedId,
    footprint: { x_in: 0, y_in: 72, w_in: 48, l_in: 48 },
    spacingPattern: 'square'
  });
  expect(outside.status).toBe(400);
  expect(outside.body.code).toBe('OUTSIDE_AREA');

  const moved = await send<{
    planting: { plantingDateMs: number; plantCount: number; plantCountProvenance: string };
  }>(page, 'patch', `/api/crops/${cropId}`, {
    action: 'set-placement',
    blockId: bedId,
    footprint: { x_in: 0, y_in: 48, w_in: 48, l_in: 48 },
    spacingPattern: 'square',
    plantCount: 20,
    plantingDateMs: apr1
  });
  expect(moved.status).toBe(200);
  expect(moved.body.planting).toMatchObject({
    plantingDateMs: apr1,
    plantCount: 20,
    plantCountProvenance: 'manual'
  });

  const fill = await send<{
    provenance: string;
    fallbackReason: string | null;
    message: string;
    proposals: Array<{ provenance: string; blockId: string; footprint: { y_in: number } }>;
  }>(page, 'post', `/api/garden/beds/${bedId}/fill`, { dateMs: apr1, seasonYear: year });
  expect(fill.status).toBe(200);
  expect(fill.body.provenance).toBe('fallback');
  expect(fill.body.fallbackReason).toBe('no-key');
  expect(fill.body.message).toMatch(/^Claude is off, so this is a plain plan/);
  expect(fill.body.proposals.length).toBeGreaterThan(0);
  for (const p of fill.body.proposals) {
    expect(p.provenance).toBe('fallback');
    expect(p.blockId).toBe(bedId);
  }
});

test('helpers cannot place crops or ask to fill a bed', async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.request.post('/?/demo', {
    form: { role: 'helper' },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  const fill = await send(page, 'post', '/api/garden/beds/any-bed/fill', {
    dateMs: Date.UTC(2027, 3, 1),
    seasonYear: 2027
  });
  expect(fill.status).toBe(403);
  const place = await send(page, 'patch', '/api/crops/any-crop', {
    action: 'set-placement',
    blockId: 'any-bed',
    footprint: null,
    spacingPattern: 'square'
  });
  expect(place.status).toBe(403);
});
