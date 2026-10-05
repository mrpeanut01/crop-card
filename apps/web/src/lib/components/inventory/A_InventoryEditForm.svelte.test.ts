/**
 * @vitest-environment jsdom
 *
 * Sprint 8 / Phase 27D — A_InventoryEditForm per-type validation,
 * #253 seed plugin requirement, #199 defaultUnit included on submit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {})
}));

import A_InventoryEditForm from './A_InventoryEditForm.svelte';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify({ item: { id: 'new', displayName: 'x' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as never;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Vitest 3+ restoreAllMocks no longer clears vi.fn() call history, so
  // the module-level `goto` mock would carry calls across tests.
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('A_InventoryEditForm — Sprint 8 add flow', () => {
  it('renders the pesticide add form with REQUIRED chips on identity', () => {
    const { container, getByText } = render(A_InventoryEditForm, { type: 'pesticide' });
    expect(getByText(/New pesticide/i)).toBeInTheDocument();
    // Identity section required fields
    expect(container.querySelector('#displayName')).toBeInTheDocument();
    expect(container.querySelector('#defaultUnit')).toBeInTheDocument();
    // Multiple REQUIRED chips expected (displayName + defaultUnit + maybe category)
    const requiredChips = container.querySelectorAll('.chip-required');
    expect(requiredChips.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the plugin section as REQUIRED for seed (#253)', () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed' });
    const pluginField = container.querySelector('#pluginId');
    expect(pluginField).toBeInTheDocument();
    // Plugin field should carry the REQUIRED chip for seed.
    const label = pluginField?.closest('.inv-field')?.querySelector('.chip');
    expect(label?.textContent).toMatch(/REQUIRED/);
  });

  it('shows the product link as FROM LIBRARY (optional) for pesticide', () => {
    const { container } = render(A_InventoryEditForm, { type: 'pesticide' });
    const pluginField = container.querySelector('#pluginId');
    const label = pluginField?.closest('.inv-field')?.querySelector('.chip');
    expect(label?.textContent).toMatch(/FROM LIBRARY/);
  });

  it('blocks submit when displayName is empty', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'pesticide' });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    // Validate sets fieldErrors; we expect a visible alert on the displayName field.
    expect(container.querySelector('.inv-field.has-error')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks submit on seed type when pluginId is empty (#253)', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed' });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'My seed' } });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    // Error must surface and fetch must not fire.
    const errors = container.querySelectorAll('.inv-field.has-error');
    expect(errors.length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submits to POST /api/stock with defaultUnit on a valid pesticide add (#199)', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'pesticide' });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Roundup PowerMAX' } });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    // Wait a microtask for the async submit handler.
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.fetch).toHaveBeenCalled();
    const callArgs = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(callArgs[0]).toBe('/api/stock');
    const body = JSON.parse((callArgs[1] as { body: string }).body);
    expect(body.defaultUnit).toBeTruthy(); // #199 — never undefined
    expect(body.displayName).toBe('Roundup PowerMAX');
    expect(body.category).toBeTruthy();
  });

  it('submits PATCH to /api/stock/[id] in edit mode', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'pesticide',
      existing: {
        id: 'sk_abc',
        displayName: 'Existing',
        category: 'herbicide',
        defaultUnit: 'gal',
        pluginId: 'glyphosate-roundup'
      } as never
    });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Existing (edited)' } });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 0));
    const callArgs = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(callArgs[0]).toBe('/api/stock/sk_abc');
    expect((callArgs[1] as { method: string }).method).toBe('PATCH');
  });

  it('an edited seed shows its saved category as saved, never as "You picked"', () => {
    const { getByTestId } = render(A_InventoryEditForm, {
      type: 'seed',
      library: [{ id: 'tomato-cherokee-purple', name: 'Tomato, Cherokee Purple' }],
      existing: {
        id: 'sk_seed',
        displayName: 'Cherokee Purple',
        category: 'seed',
        defaultUnit: 'seeds',
        pluginId: 'tomato-cherokee-purple'
      } as never
    });
    const current = getByTestId('pluginId-current');
    expect(current.textContent).not.toMatch(/You picked/i);
    expect(current.querySelector('[data-provenance="plugin"]')).toBeInTheDocument();
    expect(current.textContent).toMatch(/Saved/);
  });

  it('crop type renders the deferred-banner and refuses submit', async () => {
    const { container, getByText } = render(A_InventoryEditForm, { type: 'crop' });
    expect(getByText(/Crop categories are versioned/)).toBeInTheDocument();
    const input = container.querySelector('#displayName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'New crop' } });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 0));
    // Fetch should NOT have been called — crop bails before submit.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('A_InventoryEditForm — #296 type-aware placeholders + prefill', () => {
  it('uses a seed example placeholder on the seed form (not pesticide)', () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed' });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    expect(input.placeholder).toMatch(/Tomato/i);
    expect(input.placeholder).not.toMatch(/Roundup/i);
  });

  it('keeps the Roundup placeholder on the pesticide form', () => {
    const { container } = render(A_InventoryEditForm, { type: 'pesticide' });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    expect(input.placeholder).toMatch(/Roundup/i);
  });

  it('pre-populates fields from a scan/search draft and shows a provenance banner', () => {
    const { container, getByRole, getByTestId } = render(A_InventoryEditForm, {
      type: 'seed',
      prefill: {
        source: 'ai',
        displayName: 'Cherokee Purple Tomato',
        category: 'seed',
        defaultUnit: 'seeds',
        pluginId: 'tomato-cherokee-purple'
      }
    });
    const name = container.querySelector('#displayName') as HTMLInputElement;
    expect(name.value).toBe('Cherokee Purple Tomato');
    expect(getByTestId('pluginId-current').textContent).toMatch(/tomato-cherokee-purple/);
    // Provenance banner present for a non-manual source.
    expect(getByRole('status').textContent).toMatch(/review/i);
  });

  it('ignores a prefilled category that is invalid for the type', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'fertility',
      prefill: { source: 'ai', category: 'herbicide', displayName: 'Mislabeled' }
    });
    // fertility only allows 'fertilizer'; the bad 'herbicide' category must be
    // dropped on prefill. Submit and assert the posted category is corrected.
    const input = container.querySelector('#displayName') as HTMLInputElement;
    expect(input.value).toBe('Mislabeled');
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.fetch).toHaveBeenCalled();
    const callArgs = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    const body = JSON.parse((callArgs[1] as { body: string }).body);
    expect(body.category).toBe('fertilizer');
    expect(body.category).not.toBe('herbicide');
  });

  it('shows no provenance banner for a manual (empty) draft', () => {
    const { queryByRole } = render(A_InventoryEditForm, {
      type: 'seed',
      prefill: { source: 'manual' }
    });
    expect(queryByRole('status')).toBeNull();
  });
});

describe('A_InventoryEditForm — canonical save path for batch review (#249)', () => {
  function lastBody(): Record<string, unknown> {
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return JSON.parse((calls[calls.length - 1][1] as { body: string }).body);
  }

  it('create omits empty optional fields instead of sending null (POST /api/stock rejects null)', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'pesticide',
      prefill: { source: 'ai', displayName: 'Scanned Herbicide', category: 'herbicide' }
    });
    await fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const body = lastBody();
    expect(body.displayName).toBe('Scanned Herbicide');
    expect('pluginId' in body).toBe(false);
    expect('reorderThreshold' in body).toBe(false);
  });

  it('edit still sends null so PATCH can clear the plugin link', async () => {
    const { container, getByRole } = render(A_InventoryEditForm, {
      type: 'pesticide',
      existing: {
        id: 'stk1',
        displayName: 'Old',
        category: 'herbicide',
        defaultUnit: 'fl-oz',
        pluginId: 'x'
      }
    });
    await fireEvent.click(getByRole('button', { name: 'Clear the product' }));
    await fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(lastBody().pluginId).toBeNull();
  });

  it('calls onSaved instead of navigating when provided', async () => {
    const { goto } = await import('$app/navigation');
    const onSaved = vi.fn();
    const { container } = render(A_InventoryEditForm, {
      type: 'pesticide',
      prefill: { source: 'ai', displayName: 'Batch item' },
      onSaved
    });
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(goto).not.toHaveBeenCalled();
  });

  it('records the first quantity as an ordered lot and hands back the new id (#475)', async () => {
    const onSaved = vi.fn();
    const { container } = render(A_InventoryEditForm, {
      type: 'seed',
      prefill: { source: 'manual', displayName: 'Cherokee Purple', pluginId: 'tomato' },
      onSaved
    });
    const qty = container.querySelector('#quantity') as HTMLInputElement;
    await fireEvent.input(qty, { target: { value: '40' } });
    const status = container.querySelector('#initialStatus') as HTMLSelectElement;
    await fireEvent.change(status, { target: { value: 'ordered' } });
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'new' }));
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls;
    expect(calls.map((c) => c[0])).toEqual(['/api/stock', '/api/stock/new/lots']);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({
      receivedQuantity: 40,
      unit: 'seeds',
      quantityStatus: 'ordered'
    });
  });

  it('skips the lot when no quantity is typed', async () => {
    const onSaved = vi.fn();
    const { container } = render(A_InventoryEditForm, {
      type: 'seed',
      prefill: { source: 'manual', displayName: 'Uncounted', pluginId: 'tomato' },
      onSaved
    });
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(
      1
    );
  });

  it('surfaces an honest message when a helper hits the owner-only gate', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'owner role required' }), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        })
    ) as never;
    const { container, findByRole } = render(A_InventoryEditForm, {
      type: 'pesticide',
      prefill: { source: 'ai', displayName: 'Helper try' }
    });
    await fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/Only the farm owner can save/);
  });
});

describe('A_InventoryEditForm — seed quantity and crop category (#472, #473)', () => {
  const library = [
    { id: 'tomato-cherokee-purple', name: 'Tomato — Cherokee Purple (heirloom)' },
    { id: 'tomato-sungold', name: 'Tomato Sungold F1' },
    { id: 'basil-genovese', name: 'Basil — Genovese' }
  ];

  function calls(): Array<[string, { method: string; body: string }]> {
    return (globalThis.fetch as unknown as { mock: { calls: never[] } }).mock.calls;
  }

  it('offers Seeds first plus weights, and no pesticide units', () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed', library });
    const select = container.querySelector('#defaultUnit') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['seeds', 'oz', 'lb', 'g']);
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Seeds',
      'oz',
      'lb',
      'g'
    ]);
    expect(select.value).toBe('seeds');
  });

  it('reads a scanned "count" seed unit as Seeds', () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      prefill: { source: 'ai', displayName: 'X', defaultUnit: 'count' }
    });
    expect((container.querySelector('#defaultUnit') as HTMLSelectElement).value).toBe('seeds');
  });

  it('auto-matches the category from the name and tags it as data', async () => {
    const { container, getByTestId } = render(A_InventoryEditForm, { type: 'seed', library });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Cherokee Purple Heirloom Tomato Seeds' }
    });
    const current = getByTestId('pluginId-current');
    expect(current.textContent).toMatch(/Cherokee Purple/);
    expect(current.querySelector('[data-provenance="data"]')).not.toBeNull();
  });

  it('leaves the category for the operator when the name fits more than one entry (#472 review)', async () => {
    const { container, queryByTestId } = render(A_InventoryEditForm, { type: 'seed', library });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Tomato' }
    });
    expect(queryByTestId('pluginId-current')).toBeNull();
    await fireEvent.submit(container.querySelector('form')!);
    expect(container.textContent).toMatch(/Pick a crop category/);
  });

  it('points an owner with ordered seed to Mark received instead of On hand (#475 review)', () => {
    const { getByTestId } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      existing: {
        id: 'bean',
        displayName: 'Provider Bush Bean',
        category: 'seed',
        defaultUnit: 'seeds',
        pluginId: 'tomato-sungold',
        onHand: 0,
        onOrder: 200,
        lotCount: 1
      }
    });
    const note = getByTestId('expected-note');
    expect(note.textContent).toMatch(/200 seeds ordered/);
    expect(note.textContent).toMatch(/Mark received/);
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/inventory/seed/bean');
  });

  it('shows no ordered note when nothing is expected', () => {
    const { queryByTestId } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      existing: {
        id: 'bean',
        displayName: 'Provider Bush Bean',
        category: 'seed',
        defaultUnit: 'seeds',
        pluginId: 'tomato-sungold',
        onHand: 10,
        lotCount: 1
      }
    });
    expect(queryByTestId('expected-note')).toBeNull();
  });

  it('creates the item, then its first lot with the quantity and lot number', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed', library });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Sungold Tomato' }
    });
    await fireEvent.input(container.querySelector('#quantity')!, { target: { value: '250' } });
    await fireEvent.input(container.querySelector('#lotNumber')!, { target: { value: 'L-42' } });
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls()).toHaveLength(2));
    const [create, lot] = calls();
    expect(create[0]).toBe('/api/stock');
    expect(JSON.parse(create[1].body)).toMatchObject({
      category: 'seed',
      defaultUnit: 'seeds',
      pluginId: 'tomato-sungold'
    });
    expect(lot[0]).toBe('/api/stock/new/lots');
    expect(JSON.parse(lot[1].body)).toEqual({
      receivedQuantity: 250,
      unit: 'seeds',
      lotNumber: 'L-42'
    });
  });

  it('skips the lot when no quantity is entered', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'seed', library });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Genovese Basil' }
    });
    await fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls()).toHaveLength(1);
  });

  it('a picked category wins over the auto-match and is tagged manual', async () => {
    const { container, getByRole, getByTestId } = render(A_InventoryEditForm, {
      type: 'seed',
      library
    });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Sungold Tomato' }
    });
    const box = container.querySelector('#pluginId') as HTMLInputElement;
    await fireEvent.focus(box);
    await fireEvent.input(box, { target: { value: 'basil' } });
    await fireEvent.mouseDown(getByRole('option', { name: /Basil/ }));
    expect(getByTestId('pluginId-current').textContent).toMatch(/Basil/);
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Sungold Tomato F1' }
    });
    expect(getByTestId('pluginId-current').textContent).toMatch(/Basil/);
  });

  it('retries only the lot when the first lot failed', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      n++;
      if (url.endsWith('/lots') && n === 2) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return new Response(JSON.stringify({ item: { id: 'new' } }), { status: 201 });
    }) as never;
    const { container, findByRole } = render(A_InventoryEditForm, { type: 'seed', library });
    await fireEvent.input(container.querySelector('#displayName')!, {
      target: { value: 'Sungold Tomato' }
    });
    await fireEvent.input(container.querySelector('#quantity')!, { target: { value: '10' } });
    await fireEvent.submit(container.querySelector('form')!);
    expect((await findByRole('alert')).textContent).toMatch(/quantity did not save/);
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls().map((c) => c[0])).toEqual([
      '/api/stock',
      '/api/stock/new/lots',
      '/api/stock/new/lots'
    ]);
  });

  const existingSeed = {
    id: 'sk1',
    displayName: 'Sungold',
    category: 'seed' as const,
    defaultUnit: 'count' as const,
    pluginId: 'tomato-sungold',
    onHand: 100,
    lotCount: 1
  };

  it('edit posts a set-quantity adjustment when on hand changes', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      existing: existingSeed
    });
    const qty = container.querySelector('#quantity') as HTMLInputElement;
    expect(qty.value).toBe('100');
    await fireEvent.input(qty, { target: { value: '60' } });
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[0][0]).toBe('/api/stock/sk1');
    expect(calls()[1][0]).toBe('/api/stock/sk1/set-quantity');
    expect(JSON.parse(calls()[1][1].body)).toMatchObject({ quantity: 60, base: { onHand: 100 } });
  });

  it('shows the short choice when on hand changed elsewhere, and Keep my change resends', async () => {
    let refused = false;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/set-quantity') && !refused) {
        refused = true;
        return new Response(
          JSON.stringify({
            error: 'Someone else changed this while you were editing. Nothing was saved.',
            code: 'EDIT_CONFLICT',
            target: 'stock',
            id: 'sk1',
            action: 'set-quantity',
            fields: [{ field: 'onHand', base: 100, mine: 60, theirs: 80 }],
            current: { onHand: 80 }
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ item: { id: 'sk1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as never;
    const { container, findByText, getByRole } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      existing: existingSeed
    });
    const qty = container.querySelector('#quantity') as HTMLInputElement;
    await fireEvent.input(qty, { target: { value: '60' } });
    await fireEvent.submit(container.querySelector('form')!);
    expect(await findByText('Changed on another device')).toBeInTheDocument();
    expect(container.querySelector('.error-banner')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Keep my change' }));
    await vi.waitFor(() => expect(calls()).toHaveLength(4));
    expect(calls()[3][0]).toBe('/api/stock/sk1/set-quantity');
    expect(JSON.parse(calls()[3][1].body)).toMatchObject({ quantity: 60, base: { onHand: 80 } });
  });

  it('edit leaves the quantity alone when unchanged, and locks the unit once stocked', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'seed',
      library,
      existing: existingSeed
    });
    const unit = container.querySelector('#defaultUnit') as HTMLSelectElement;
    expect(unit.disabled).toBe(true);
    expect(unit.options[0].value).toBe('count');
    expect(unit.options[0].textContent?.trim()).toBe('Seeds');
    expect(container.querySelector('#lotNumber')).toBeNull();
    await fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls()).toHaveLength(1);
  });
});
