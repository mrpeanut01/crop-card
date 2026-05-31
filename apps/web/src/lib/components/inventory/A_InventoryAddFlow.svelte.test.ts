/**
 * @vitest-environment jsdom
 *
 * #296 — multi-modal add flow shell. Verifies method gating by aiEnabled
 * (Invariant 7: Claude-required methods hidden with no key), the manual
 * fast-path into the approval form, and the sprayer bare-form bypass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {})
}));

import A_InventoryAddFlow from './A_InventoryAddFlow.svelte';

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('A_InventoryAddFlow — method gating', () => {
  it('hides Claude-required methods when aiEnabled is false', () => {
    const { queryByRole } = render(A_InventoryAddFlow, { type: 'seed', aiEnabled: false });
    expect(queryByRole('tab', { name: /Search/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /Scan barcode/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /Type it in/i })).not.toBeNull();
    // AI-gated methods absent:
    expect(queryByRole('tab', { name: /Scan label/i })).toBeNull();
    expect(queryByRole('tab', { name: /From URL/i })).toBeNull();
  });

  it('shows all methods when aiEnabled is true', () => {
    const { queryByRole } = render(A_InventoryAddFlow, { type: 'seed', aiEnabled: true });
    expect(queryByRole('tab', { name: /Scan label/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /From URL/i })).not.toBeNull();
  });

  it('surfaces a no-key note linking to Settings when aiEnabled is false', () => {
    const { getByText } = render(A_InventoryAddFlow, { type: 'seed', aiEnabled: false });
    expect(getByText(/Claude API key/i)).toBeInTheDocument();
  });

  it('manual method jumps straight to the approval form', async () => {
    const { getByRole, container } = render(A_InventoryAddFlow, {
      type: 'seed',
      aiEnabled: false
    });
    await fireEvent.click(getByRole('tab', { name: /Type it in/i }));
    // The edit form mounts — its displayName input appears.
    expect(container.querySelector('#displayName')).toBeInTheDocument();
    // ...and the back link to return to the picker.
    expect(getByRole('button', { name: /different method/i })).toBeInTheDocument();
  });

  it('sprayer renders the bare form with no method picker', () => {
    const { container, queryByRole } = render(A_InventoryAddFlow, {
      type: 'sprayer',
      aiEnabled: true
    });
    expect(container.querySelector('#displayName')).toBeInTheDocument();
    expect(queryByRole('tab')).toBeNull();
  });
});
