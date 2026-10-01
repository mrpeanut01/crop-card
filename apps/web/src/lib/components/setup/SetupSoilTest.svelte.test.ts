/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupSoilTest from './SetupSoilTest.svelte';

const uploaded = {
  id: 'docNew',
  kind: 'lab-report',
  title: 'Wrong file',
  mime: 'application/pdf',
  byteSize: 1000,
  sha256: 'x',
  originalName: 'wrong.pdf',
  createdAt: '2026-09-01T12:00:00Z',
  uploadedBy: null,
  deletedAt: null,
  deletedBy: null,
  links: []
};

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
let soilTestStatus = 201;

beforeEach(() => {
  soilTestStatus = 201;
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/documents?') && init?.method === 'POST') {
      return new Response(JSON.stringify({ document: uploaded }), { status: 201 });
    }
    if (u === '/api/documents/docNew' && init?.method === 'DELETE') {
      return new Response(
        JSON.stringify({ document: { ...uploaded, deletedAt: '2026-09-02T12:00:00Z' } })
      );
    }
    if (u.startsWith('/api/documents?')) {
      return new Response(
        JSON.stringify({ documents: [], vault: { enabled: true }, canDelete: true })
      );
    }
    if (u === '/api/fertility/soil-tests') {
      return soilTestStatus === 201
        ? new Response(JSON.stringify({ soilTest: { id: 's1', blockId: 'b1' } }), { status: 201 })
        : new Response(
            JSON.stringify({
              error: 'This file was deleted, so it cannot be attached.',
              code: 'DOCUMENT_DELETED'
            }),
            { status: 409 }
          );
    }
    return new Response('{}', { status: 404 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setup() {
  const onDone = vi.fn();
  render(SetupSoilTest, {
    places: [{ id: 'b1', name: 'Back bed' }] as never,
    canEdit: true,
    onDone
  });
  return onDone;
}

async function attachAndDelete() {
  const input = screen.getByTestId('document-attach-input') as HTMLInputElement;
  const file = new File(['%PDF-1.4'], 'wrong.pdf', { type: 'application/pdf' });
  await fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('Wrong file');
  await fireEvent.click(await screen.findByRole('button', { name: 'Delete file' }));
  await fireEvent.click(screen.getByTestId('document-delete-confirm'));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'DELETE')).toBe(true)
  );
}

describe('SetupSoilTest lab report', () => {
  it('saves without the report after the just-uploaded file is deleted', async () => {
    const onDone = setup();
    await attachAndDelete();
    await fireEvent.input(screen.getByLabelText('Soil pH'), { target: { value: '6.5' } });
    await fireEvent.submit(screen.getByTestId('setup-soil-test'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/fertility/soil-tests');
    expect(JSON.parse((post![1] as RequestInit).body as string).documentId).toBeUndefined();
  });

  it("shows the server's reason when the report can't be attached", async () => {
    soilTestStatus = 409;
    setup();
    await fireEvent.input(screen.getByLabelText('Soil pH'), { target: { value: '6.5' } });
    await fireEvent.submit(screen.getByTestId('setup-soil-test'));
    expect(
      await screen.findByText('This file was deleted, so it cannot be attached.')
    ).toBeInTheDocument();
  });
});
