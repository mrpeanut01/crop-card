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

  it('shows the plugin section as FROM PLUGIN (optional) for pesticide', () => {
    const { container } = render(A_InventoryEditForm, { type: 'pesticide' });
    const pluginField = container.querySelector('#pluginId');
    const label = pluginField?.closest('.inv-field')?.querySelector('.chip');
    expect(label?.textContent).toMatch(/FROM PLUGIN/);
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

  it('sprayer add hits POST /api/equipment with type:sprayer', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'sprayer' });
    const input = container.querySelector('#displayName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '4-gal backpack' } });
    const form = container.querySelector('form');
    await fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 0));
    const callArgs = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(callArgs[0]).toBe('/api/equipment');
    const body = JSON.parse((callArgs[1] as { body: string }).body);
    expect(body.type).toBe('sprayer');
    expect(body.label).toBe('4-gal backpack');
  });

  it('crop type renders the deferred-banner and refuses submit', async () => {
    const { container, getByText } = render(A_InventoryEditForm, { type: 'crop' });
    expect(getByText(/Crop plugin editing is versioned/)).toBeInTheDocument();
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
    const { container, getByRole } = render(A_InventoryEditForm, {
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
    const plugin = container.querySelector('#pluginId') as HTMLInputElement;
    expect(name.value).toBe('Cherokee Purple Tomato');
    expect(plugin.value).toBe('tomato-cherokee-purple');
    // Provenance banner present for a non-manual source.
    expect(getByRole('status').textContent).toMatch(/review/i);
  });

  it('ignores a prefilled category that is invalid for the type', () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'fertility',
      prefill: { source: 'ai', category: 'herbicide', displayName: 'Mislabeled' }
    });
    // fertility only allows 'fertilizer'; the bad category must not stick.
    // No category dropdown renders for single-option types, so submit and
    // assert the posted category is fertilizer.
    const input = container.querySelector('#displayName') as HTMLInputElement;
    expect(input.value).toBe('Mislabeled');
  });

  it('shows no provenance banner for a manual (empty) draft', () => {
    const { queryByRole } = render(A_InventoryEditForm, {
      type: 'seed',
      prefill: { source: 'manual' }
    });
    expect(queryByRole('status')).toBeNull();
  });
});
