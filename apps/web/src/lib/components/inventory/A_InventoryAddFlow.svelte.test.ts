/**
 * @vitest-environment jsdom
 *
 * #296 — multi-modal add flow shell. Verifies the manual fast-path into
 * the approval form and the sprayer bare-form bypass.
 *
 * #312 / CT-S3-002 — no-key mode no longer HIDES the AI-required chips.
 * All five chips always render; clicking an AI chip with no key mounts
 * its panel, which surfaces the built-in recovery empty-state
 * ("Configure AI key" + "Switch to Manual") — Invariant 7.
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

describe('A_InventoryAddFlow — method chips', () => {
  it('renders all five chips even when aiEnabled is false (#312)', () => {
    const { queryByRole } = render(A_InventoryAddFlow, { type: 'seed', aiEnabled: false });
    expect(queryByRole('tab', { name: /Search/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /Scan barcode/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /Type it in/i })).not.toBeNull();
    // #312 — AI-required chips MUST still render so their recovery
    // empty-state is reachable (they used to be filtered out).
    expect(queryByRole('tab', { name: /Scan label/i })).not.toBeNull();
    expect(queryByRole('tab', { name: /From URL/i })).not.toBeNull();
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

  it('clicking Scan label with no key mounts the recovery empty-state (#312)', async () => {
    const { getByRole, container } = render(A_InventoryAddFlow, {
      type: 'seed',
      aiEnabled: false
    });
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const empty = container.querySelector('[data-empty-state="no-ai-key"]');
    expect(empty).not.toBeNull();
    expect(container.querySelector('[data-action="configure-ai"]')).not.toBeNull();
    expect(container.querySelector('[data-action="switch-to-manual"]')).not.toBeNull();
  });

  it('clicking From URL with no key mounts the recovery empty-state (#312)', async () => {
    const { getByRole, container } = render(A_InventoryAddFlow, {
      type: 'seed',
      aiEnabled: false
    });
    await fireEvent.click(getByRole('tab', { name: /From URL/i }));
    const empty = container.querySelector('[data-empty-state="no-ai-key"]');
    expect(empty).not.toBeNull();
    expect(container.querySelector('[data-action="configure-ai"]')).not.toBeNull();
    // No URL input in the no-key state — it would only fail on submit.
    expect(container.querySelector('#url-input')).toBeNull();
  });

  it('recovery "Switch to Manual" jumps to the approval form (#312)', async () => {
    const { getByRole, container } = render(A_InventoryAddFlow, {
      type: 'seed',
      aiEnabled: false
    });
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const switchBtn = container.querySelector<HTMLButtonElement>(
      '[data-action="switch-to-manual"]'
    );
    expect(switchBtn).not.toBeNull();
    await fireEvent.click(switchBtn!);
    expect(container.querySelector('#displayName')).toBeInTheDocument();
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
