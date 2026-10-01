import { describe, expect, it, vi } from 'vitest';
import { fileHref, refusalCopy, uploadDocument } from './client';

describe('uploadDocument', () => {
  it('sends the raw file with kind, name, title and subject in the query', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ document: { id: 'd1', title: 'T' } }, { status: 201 })
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' });
    const out = await uploadDocument(file, {
      kind: 'lab-report',
      title: '  Spring  ',
      subject: { type: 'soil-test', id: 'st1' },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const q = new URL(url, 'http://x').searchParams;
    expect(q.get('kind')).toBe('lab-report');
    expect(q.get('name')).toBe('report.pdf');
    expect(q.get('title')).toBe('Spring');
    expect(q.get('subjectType')).toBe('soil-test');
    expect(q.get('subjectId')).toBe('st1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
  });

  it('turns refusals and network errors into plain words', async () => {
    const file = new File([new Uint8Array([1])], 'x.pdf');
    const full = await uploadDocument(file, {
      kind: 'other',
      fetchImpl: (async () =>
        Response.json(
          { code: 'STORAGE_FULL', error: "Your farm's file storage is full." },
          { status: 413 }
        )) as unknown as typeof fetch
    });
    expect(full).toEqual({
      ok: false,
      code: 'STORAGE_FULL',
      message: "Your farm's file storage is full."
    });
    const offline = await uploadDocument(file, {
      kind: 'other',
      fetchImpl: (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch
    });
    expect(offline).toEqual({ ok: false, code: 'OFFLINE', message: 'Uploads need a connection.' });
  });

  it('words the common refusals', () => {
    expect(refusalCopy(503, { code: 'VAULT_OFF' })).toBe("Document storage isn't set up yet.");
    expect(refusalCopy(403, { code: 'OWNER_ONLY' })).toBe('Only the farm owner can upload files.');
    expect(refusalCopy(500, {})).toBe("We couldn't save this file. Try again.");
    expect(fileHref('a b')).toBe('/api/documents/a%20b/file');
  });
});
