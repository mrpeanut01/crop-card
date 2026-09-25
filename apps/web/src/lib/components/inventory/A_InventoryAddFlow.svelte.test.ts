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

describe('A_InventoryAddFlow — card-grid picker (#152)', () => {
  it('renders five method cards, each with a label + mono hint', () => {
    const { getAllByRole, container } = render(A_InventoryAddFlow, {
      type: 'pesticide',
      aiEnabled: true
    });
    const tabs = getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(container.querySelector('.method-grid')).not.toBeNull();
    for (const tab of tabs) {
      expect(tab.querySelector('.card-icon')).not.toBeNull();
      expect(tab.querySelector('.card-hint')?.textContent?.trim()).toBeTruthy();
    }
    expect(getAllByRole('tab', { name: /UPC · EAN · DataMatrix/ })).toHaveLength(1);
  });

  it('uses roving tabindex + arrow keys without activating the tab', async () => {
    const { getByRole } = render(A_InventoryAddFlow, { type: 'pesticide', aiEnabled: true });
    const search = getByRole('tab', { name: /Search/i });
    const barcode = getByRole('tab', { name: /Scan barcode/i });
    const manual = getByRole('tab', { name: /Type it in/i });
    expect(search.getAttribute('tabindex')).toBe('0');
    expect(barcode.getAttribute('tabindex')).toBe('-1');
    expect(search.getAttribute('aria-selected')).toBe('true');
    search.focus();
    await fireEvent.keyDown(search, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(barcode);
    await fireEvent.keyDown(barcode, { key: 'End' });
    expect(document.activeElement).toBe(manual);
    await fireEvent.keyDown(manual, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute('aria-selected')).toBe('true');
    expect(getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(search.id);
  });
});

function pickFiles(input: HTMLInputElement, files: File[]): Promise<boolean> {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  return fireEvent.change(input);
}

function img(name: string): File {
  return new File(['img'], name, { type: 'image/jpeg' });
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('A_InventoryAddFlow — stale errors do not cross methods (#201)', () => {
  it('a Scan label error disappears after switching method and back', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonRes(503, { message: 'Label read failed — upstream timeout' })
    ) as never;
    const { getByRole, container, queryByText, findByText } = render(A_InventoryAddFlow, {
      type: 'pesticide',
      aiEnabled: true
    });
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="label-file-input"]')!;
    await pickFiles(input, [img('one.jpg')]);
    await findByText(/upstream timeout/, undefined, { timeout: 5000 });

    await fireEvent.click(getByRole('tab', { name: /Search/i }));
    expect(queryByText(/upstream timeout/)).toBeNull();
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    expect(queryByText(/upstream timeout/)).toBeNull();
  });
});

describe('A_InventoryAddFlow — batch label upload (#249)', () => {
  it('queues several photos, reads them sequentially, and saves each via the canonical form', async () => {
    const calls: string[] = [];
    let n = 0;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (String(url) === '/api/scan-label') {
        n++;
        return jsonRes(200, {
          found: true,
          source: 'claude-vision',
          displayName: `Product ${n}`,
          category: 'herbicide'
        });
      }
      if (String(url) === '/api/stock') return jsonRes(200, { id: `s${n}` });
      return jsonRes(404, {});
    }) as never;

    const { getByRole, container, findByText, getByText, getAllByTestId } = render(
      A_InventoryAddFlow,
      { type: 'pesticide', aiEnabled: true }
    );
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="label-file-input"]')!;
    expect(input.multiple).toBe(true);
    await pickFiles(input, [img('a.jpg'), img('b.jpg'), img('c.jpg')]);

    await findByText(/3 of 3 read/, undefined, { timeout: 5000 });
    expect(getAllByTestId('batch-row')).toHaveLength(3);
    expect(calls.filter((c) => c === '/api/scan-label')).toHaveLength(3);

    await fireEvent.click(getByRole('button', { name: /Review Product 1/ }));
    const name = container.querySelector<HTMLInputElement>('#displayName')!;
    expect(name.value).toBe('Product 1');
    expect(getByRole('button', { name: /Back to batch queue/ })).toBeInTheDocument();

    await fireEvent.submit(container.querySelector('form')!);
    await findByText(/Saved Product 1\. 2 drafts left to review\./, undefined, { timeout: 5000 });
    expect(calls.filter((c) => c === '/api/stock')).toHaveLength(1);
    expect(getByText(/1 saved/)).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: /Review next draft/ }));
    expect(container.querySelector<HTMLInputElement>('#displayName')!.value).toBe('Product 2');
  });

  it('a no-key failure stops the queue with an honest message and recovery CTAs', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      return n === 1
        ? jsonRes(200, { found: true, displayName: 'First', category: 'herbicide' })
        : jsonRes(400, { message: 'No Anthropic API key configured' });
    }) as never;
    const { getByRole, container, findByTestId, getAllByTestId } = render(A_InventoryAddFlow, {
      type: 'pesticide',
      aiEnabled: true
    });
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="label-file-input"]')!;
    await pickFiles(input, [img('1.jpg'), img('2.jpg'), img('3.jpg'), img('4.jpg')]);

    const stop = await findByTestId('batch-stop', undefined, { timeout: 5000 });
    await vi.waitFor(() => expect(stop.textContent).toMatch(/2 photos\s+were not sent/), {
      timeout: 5000
    });
    expect(stop.textContent).toMatch(/No Anthropic API key configured/);
    expect(n).toBe(2);
    expect(getAllByTestId('batch-row').map((r) => r.dataset.status)).toEqual([
      'done',
      'failed',
      'queued',
      'queued'
    ]);
    expect(getByRole('link', { name: /Add Claude key/ })).toBeInTheDocument();
    expect(getByRole('button', { name: /Use Manual entry instead/ })).toBeInTheDocument();
  });

  it('a single picked photo keeps the single-shot path (no queue)', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonRes(200, { found: true, displayName: 'Solo', category: 'herbicide' })
    ) as never;
    const { getByRole, container, queryByTestId } = render(A_InventoryAddFlow, {
      type: 'pesticide',
      aiEnabled: true
    });
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="label-file-input"]')!;
    await pickFiles(input, [img('solo.jpg')]);
    await vi.waitFor(
      () => expect(container.querySelector<HTMLInputElement>('#displayName')?.value).toBe('Solo'),
      { timeout: 5000 }
    );
    expect(queryByTestId('label-batch')).toBeNull();
    expect(getByRole('button', { name: /different method/ })).toBeInTheDocument();
  });
});

describe('A_InventoryAddFlow — helper role', () => {
  it('shows the owner-only note and keeps the label picker single-file', async () => {
    const { getByRole, getByTestId, container } = render(A_InventoryAddFlow, {
      type: 'pesticide',
      aiEnabled: true,
      canSave: false
    });
    expect(getByTestId('helper-note').textContent).toMatch(/only the farm owner can\s+save/i);
    await fireEvent.click(getByRole('tab', { name: /Scan label/i }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="label-file-input"]')!;
    expect(input.multiple).toBe(false);
  });
});
