/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DocumentAttach from './DocumentAttach.svelte';
import type { DocumentMeta } from '$lib/documents/apiSchemas';

function doc(id: string, title: string, deletedAt: string | null = null): DocumentMeta {
  return {
    id,
    kind: 'lab-report',
    title,
    mime: 'application/pdf',
    byteSize: 1000,
    sha256: 'x',
    originalName: null,
    createdAt: '2026-09-01T12:00:00Z',
    uploadedBy: null,
    deletedAt,
    deletedBy: null,
    links: []
  } as unknown as DocumentMeta;
}

const A = doc('docA', 'Report A');
const B = doc('docB', 'Report B');
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === '/api/documents/docA' && init?.method === 'DELETE') {
      return new Response(
        JSON.stringify({ document: { ...A, deletedAt: '2026-09-02T12:00:00Z' } })
      );
    }
    if (u === '/api/documents/docA') return new Response(JSON.stringify({ document: A }));
    if (u === '/api/documents/docB') return new Response(JSON.stringify({ document: B }));
    if (u.startsWith('/api/documents?')) {
      return new Response(
        JSON.stringify({ documents: [A, B], vault: { enabled: true }, canDelete: true })
      );
    }
    return new Response('{}', { status: 404 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function metaLoads(id: string): number {
  return fetchMock.mock.calls.filter(
    (c) => String(c[0]) === `/api/documents/${id}` && !(c[1] as RequestInit | undefined)?.method
  ).length;
}

describe('DocumentAttach', () => {
  it('keeps showing the picked file after a save, without snapping back', async () => {
    const onchange = vi.fn(async () => true);
    render(DocumentAttach, { documentId: 'docA', kind: 'lab-report', canEdit: true, onchange });
    await screen.findByText('Report A');
    await fireEvent.click(await screen.findByRole('button', { name: 'Pick from your files' }));
    await fireEvent.click(screen.getByRole('button', { name: /Report B/ }));
    await waitFor(() => expect(onchange).toHaveBeenCalledWith('docB'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Report B')).toBeInTheDocument();
    expect(screen.queryByText('Report A')).toBeNull();
    expect(metaLoads('docA')).toBe(1);
  });

  it('keeps the control empty after a saved remove', async () => {
    const onchange = vi.fn(async () => true);
    render(DocumentAttach, { documentId: 'docA', kind: 'lab-report', canEdit: true, onchange });
    await screen.findByText('Report A');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove from this record' }));
    await waitFor(() => expect(onchange).toHaveBeenCalledWith(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Report A')).toBeNull();
    expect(screen.getByText('Attach a file')).toBeInTheDocument();
  });

  it('goes back to the attached file when the save fails', async () => {
    const onchange = vi.fn(async () => false);
    render(DocumentAttach, { documentId: 'docA', kind: 'lab-report', canEdit: true, onchange });
    await screen.findByText('Report A');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove from this record' }));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Report A')).toBeInTheDocument());
  });

  it('tells the parent when the attached file is deleted', async () => {
    const ondelete = vi.fn();
    render(DocumentAttach, {
      documentId: 'docA',
      kind: 'lab-report',
      canEdit: true,
      onchange: vi.fn(),
      ondelete
    });
    await screen.findByText('Report A');
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete file' }));
    await fireEvent.click(screen.getByTestId('document-delete-confirm'));
    await waitFor(() => expect(ondelete).toHaveBeenCalledWith('docA'));
  });

  it('disables Remove from this record offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(DocumentAttach, {
      documentId: 'docA',
      kind: 'lab-report',
      canEdit: true,
      onchange: vi.fn()
    });
    await screen.findByText('Report A');
    expect(screen.getByRole('button', { name: 'Remove from this record' })).toBeDisabled();
  });
});
