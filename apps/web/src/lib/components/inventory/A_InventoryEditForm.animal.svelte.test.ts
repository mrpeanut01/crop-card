/**
 * @vitest-environment jsdom
 *
 * Phase 32D (D4): the feed and animal-health field maps in the canonical
 * inventory form. Bag size (D0-13), the medicated refusal (D0-14) and the
 * NADA number with a confirm-only library suggestion (D0-15).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

import A_InventoryEditForm from './A_InventoryEditForm.svelte';

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ item: { id: 'new' } }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
  }) as never;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

async function type(container: HTMLElement, sel: string, value: string) {
  await fireEvent.input(container.querySelector(sel)!, { target: { value } });
}

describe('feed form map', () => {
  it('defaults to bags, offers feed or bedding, and has no library link', () => {
    const { container, getByText } = render(A_InventoryEditForm, { type: 'feed' });
    expect(getByText('New feed or bedding')).toBeInTheDocument();
    expect((container.querySelector('#defaultUnit') as HTMLSelectElement).value).toBe('bag');
    const kinds = [...container.querySelectorAll('#category option')].map((o) => o.textContent);
    expect(kinds).toEqual(['Feed', 'Bedding']);
    expect(container.querySelector('#pluginId')).toBeNull();
  });

  it('needs pounds per bag when counted in bags', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'feed' });
    await type(container, '#displayName', 'Layer pellets');
    await fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('#lbPerBag')?.closest('.inv-field')).toHaveClass('has-error');
    expect(calls).toHaveLength(0);
  });

  it('saves bag size and scoop in the item metadata', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'feed' });
    await type(container, '#displayName', 'Layer pellets');
    await type(container, '#lbPerBag', '50');
    await type(container, '#scoopLb', '1.5');
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toBe('/api/stock');
    expect(calls[0].body).toMatchObject({ category: 'feed', defaultUnit: 'bag' });
    expect(JSON.parse(String(calls[0].body.metadataJson))).toEqual({
      feed: { lbPerBag: 50, scoopLb: 1.5 }
    });
  });

  it('refuses medicated feed and steers to animal health', async () => {
    const { container, getByTestId, getByRole } = render(A_InventoryEditForm, { type: 'feed' });
    await fireEvent.click(container.querySelector('#medicated')!);
    expect(getByTestId('medicated-refusal')).toHaveTextContent(
      'Medicated feed carries a withdrawal; add it as animal-health stock.'
    );
    expect(getByRole('link', { name: /Add it as animal health/ })).toHaveAttribute(
      'href',
      '/inventory/animal-health/add'
    );
    expect(getByRole('button', { name: /Create feed or bedding/ })).toBeDisabled();
  });
});

describe('animal-health form map', () => {
  it('keeps a scanned NADA tagged ai and never takes a library link from the draft', async () => {
    const { container, getByTestId, queryByTestId } = render(A_InventoryEditForm, {
      type: 'animal-health',
      library: [{ id: 'test-fixture-dewormer', name: 'Test fixture dewormer' }],
      prefill: {
        source: 'ai',
        displayName: 'Example Dewormer',
        pluginId: 'test-fixture-dewormer',
        nada: { kind: 'NADA', number: '141-061' },
        suggestedHealthPlugin: {
          pluginId: 'test-fixture-dewormer',
          displayName: 'Test fixture dewormer'
        }
      }
    });
    expect((container.querySelector('#nada') as HTMLInputElement).value).toBe('NADA 141-061');
    expect(getByTestId('suggested-link')).toHaveTextContent('Test fixture dewormer');
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].body.pluginId).toBeUndefined();
    expect(JSON.parse(String(calls[0].body.metadataJson))).toEqual({
      animalHealth: { nada: { kind: 'NADA', number: '141-061', provenance: 'ai' } }
    });
    expect(queryByTestId('suggested-link')).toBeInTheDocument();
  });

  it('links the suggested product only after the owner confirms, stored as manual', async () => {
    const { container, getByRole, queryByTestId } = render(A_InventoryEditForm, {
      type: 'animal-health',
      library: [{ id: 'test-fixture-dewormer', name: 'Test fixture dewormer' }],
      prefill: {
        source: 'ai',
        displayName: 'Example Dewormer',
        nada: { kind: 'NADA', number: '141-061' },
        suggestedHealthPlugin: {
          pluginId: 'test-fixture-dewormer',
          displayName: 'Test fixture dewormer'
        }
      }
    });
    await fireEvent.click(getByRole('button', { name: 'Link it' }));
    expect(queryByTestId('suggested-link')).toBeNull();
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].body.pluginId).toBe('test-fixture-dewormer');
    expect(JSON.parse(String(calls[0].body.metadataJson)).animalHealth.pluginLink).toBe('manual');
  });

  it('a NADA the owner retypes is manual', async () => {
    const { container } = render(A_InventoryEditForm, {
      type: 'animal-health',
      prefill: { source: 'ai', displayName: 'X', nada: { kind: 'NADA', number: '141-061' } }
    });
    await type(container, '#nada', 'ANADA 200-420');
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(JSON.parse(String(calls[0].body.metadataJson)).animalHealth.nada).toEqual({
      kind: 'ANADA',
      number: '200-420',
      provenance: 'manual'
    });
  });

  it('says the library is empty instead of showing a picker', () => {
    const { getByTestId, container } = render(A_InventoryEditForm, { type: 'animal-health' });
    expect(getByTestId('no-health-library')).toBeInTheDocument();
    expect(container.querySelector('#pluginId')).toBeNull();
    expect((container.querySelector('#defaultUnit') as HTMLSelectElement).value).toBe('ml');
  });

  it('rejects a malformed NADA number', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'animal-health' });
    await type(container, '#displayName', 'Dewormer');
    await type(container, '#nada', 'NADA 12');
    await fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('#nada')?.closest('.inv-field')).toHaveClass('has-error');
    expect(calls).toHaveLength(0);
  });
});

describe('bales from a hay cutting', () => {
  const hayCutting = { id: 'cut-1', label: 'Back hay cutting 1' };

  it('needs a quantity so the cutting link is saved', async () => {
    const { container, getByTestId } = render(A_InventoryEditForm, { type: 'feed', hayCutting });
    expect(getByTestId('hay-source')).toHaveTextContent('Back hay cutting 1');
    await type(container, '#displayName', 'Back hay bales');
    await type(container, '#lbPerBag', '40');
    await fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('#quantity')?.closest('.inv-field')).toHaveClass('has-error');
    expect(calls).toHaveLength(0);
  });

  it('sends the cutting with the first lot', async () => {
    const { container } = render(A_InventoryEditForm, { type: 'feed', hayCutting });
    await type(container, '#displayName', 'Back hay bales');
    await type(container, '#lbPerBag', '40');
    await type(container, '#quantity', '12');
    await fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].url).toBe('/api/stock/new/lots');
    expect(calls[1].body).toMatchObject({ receivedQuantity: 12, sourceHayCuttingId: 'cut-1' });
  });
});
