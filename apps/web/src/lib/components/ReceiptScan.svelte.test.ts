/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import ReceiptScan from './ReceiptScan.svelte';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/plugins/scan-receipt') {
      return sse([
        { phase: 'extracted', lines: [{ rawText: 'ROUNDUP 1 GAL' }] },
        {
          phase: 'enriched',
          lineIndex: 0,
          candidate: {
            source: 'local',
            candidate: { id: 'roundup', type: 'herbicide', displayName: 'Roundup' },
            validation: { ok: true, schemaIssues: [], bypassIssues: [] }
          }
        },
        { phase: 'complete', message: 'done' }
      ]);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ReceiptScan', () => {
  it('never uploads a saved line a second time', async () => {
    render(ReceiptScan, { onClose: vi.fn() });
    const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    await fireEvent.change(screen.getByLabelText('Receipt file'), { target: { files: [file] } });
    await fireEvent.click(screen.getByRole('button', { name: /Scan with AI/ }));
    const save = await screen.findByRole('button', { name: 'Save 1 plugin' });
    await fireEvent.click(save);
    await screen.findByText('Saved');
    const uploads = () => fetchMock.mock.calls.filter(([u]) => u === '/api/plugins/upload').length;
    expect(uploads()).toBe(1);
    const again = screen.getByRole('button', { name: /Save 0 plugins/ });
    expect(again).toBeDisabled();
    await fireEvent.click(again);
    await waitFor(() => expect(uploads()).toBe(1));
  });
});
