/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { DocumentMeta } from '$lib/documents/apiSchemas';

const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import Page from './+page.svelte';

function doc(id: string): DocumentMeta {
  return {
    id,
    kind: 'lab-report',
    title: `File ${id}`,
    mime: 'application/pdf',
    byteSize: 1000,
    sha256: 'x',
    originalName: null,
    createdAt: '2026-09-01T12:00:00Z',
    uploadedBy: null,
    deletedAt: null,
    deletedBy: null,
    links: []
  } as unknown as DocumentMeta;
}

function data(ids: string[], nextBefore: number | null, nextBeforeId: string | null) {
  return {
    isOwner: true as const,
    vaultEnabled: true,
    usedBytes: 1000,
    capBytes: 1_000_000_000,
    canDelete: true,
    kindTotals: [{ kind: 'lab-report', count: ids.length, bytes: 1000 }],
    documents: ids.map(doc),
    nextBefore,
    nextBeforeId
  };
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ document: doc('new') }), { status: 201 });
    }
    if (u.startsWith('/api/documents?before=')) {
      return new Response(
        JSON.stringify({ documents: [doc('p2')], nextBefore: null, nextBeforeId: null })
      );
    }
    return new Response('{}', { status: 404 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('/settings/documents paging', () => {
  it('asks for the next page with the id tie-break', async () => {
    render(Page, { data: data(['a', 'b'], 1000, 'b') as never });
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('File p2');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/documents?before=1000&beforeId=b');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('takes the cursor from the reloaded page after an upload', async () => {
    const view = render(Page, { data: data(['a', 'b'], 1000, 'b') as never });
    nav.invalidateAll.mockImplementationOnce(async () => {
      await view.rerender({ data: data(['new', 'a'], 900, 'a') as never });
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('File p2');
    const input = screen.getByTestId('documents-upload-input') as HTMLInputElement;
    await fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4'], 'n.pdf', { type: 'application/pdf' })] }
    });
    await waitFor(() => expect(nav.invalidateAll).toHaveBeenCalled());
    await fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(String(fetchMock.mock.calls.at(-1)![0])).toBe('/api/documents?before=900&beforeId=a')
    );
  });
});
