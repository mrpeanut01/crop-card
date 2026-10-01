// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { vaultStore } from '$lib/server/vault/store';
import { useTestVault } from '$lib/server/vault/testing';
import { getDocument } from '$lib/db/documents';
import { runWithTenant } from '$lib/db/tenant';
import {
  actAs,
  bytesOf,
  call,
  contains,
  readZip,
  seedFarm,
  uniquePdf,
  type TestFarm
} from '$lib/server/documents.testkit';
import type { DocumentMeta } from '$lib/documents/apiSchemas';
import { POST as upload } from '../../documents/+server';
import { DELETE as del } from '../../documents/[id]/+server';
import { GET as exportJson } from '../export.json/+server';
import { GET, _documentEntryName } from './+server';

const vault = useTestVault();
afterAll(() => vault.cleanup());

let farm: TestFarm;
beforeEach(() => {
  farm = seedFarm('zip');
  actAs(farm, 'owner');
});

async function put(marker: string, title: string): Promise<DocumentMeta> {
  const res = await call(upload, {
    method: 'POST',
    query: { kind: 'lab-report', title },
    body: uniquePdf(marker)
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { document: DocumentMeta }).document;
}

describe('GET /api/account/export.zip', () => {
  it('carries export.json and every live file', async () => {
    const a = await put('ZIP-A', 'Virginia Tech soil report, spring 2026');
    const b = await put('ZIP-B', 'Seed receipt');
    const gone = await put('ZIP-GONE', 'Old label');
    await call(del, { method: 'DELETE', params: { id: gone.id } });

    const res = await call(GET, { path: '/api/account/export.zip' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="cropcard-export-\d{4}-\d{2}-\d{2}\.zip"$/
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const entries = readZip(await bytesOf(res));

    const json = JSON.parse(Buffer.from(entries.get('export.json')!).toString()) as {
      schemaVersion: string;
      documents: { id: string }[];
    };
    const direct = (await (
      await call(exportJson, { path: '/api/account/export.json' })
    ).json()) as {
      schemaVersion: string;
      documents: { id: string }[];
    };
    expect(json.schemaVersion).toBe(direct.schemaVersion);
    expect(json.documents.map((d) => d.id).sort()).toEqual(
      direct.documents.map((d) => d.id).sort()
    );

    expect(_documentEntryName({ id: a.id, title: a.title, mime: a.mime })).toBe(
      `documents/${a.id}-virginia-tech-soil-report-spring-2026.pdf`
    );
    expect(
      contains(entries.get(`documents/${a.id}-virginia-tech-soil-report-spring-2026.pdf`)!, 'ZIP-A')
    ).toBe(true);
    expect(contains(entries.get(`documents/${b.id}-seed-receipt.pdf`)!, 'ZIP-B')).toBe(true);
    expect([...entries.keys()].some((k) => k.includes(gone.id))).toBe(false);
    expect(entries.has('documents/MISSING.txt')).toBe(false);
  });

  it('lists a file whose bytes are gone in MISSING.txt instead of failing', async () => {
    const lost = await put('ZIP-LOST', 'Lost lab report');
    const kept = await put('ZIP-KEPT', 'Kept lab report');
    const row = runWithTenant(farm.ownerId, () => getDocument(lost.id))!;
    await vaultStore()!.delete(row.storageKey);

    const entries = readZip(await bytesOf(await call(GET, { path: '/api/account/export.zip' })));
    expect([...entries.keys()].some((k) => k.includes(lost.id))).toBe(false);
    expect(contains(entries.get(`documents/${kept.id}-kept-lab-report.pdf`)!, 'ZIP-KEPT')).toBe(
      true
    );
    const missing = Buffer.from(entries.get('documents/MISSING.txt')!).toString();
    expect(missing).toContain(lost.id);
    expect(missing).toContain('Lost lab report');
  });

  it('is for the signed-in owner only', async () => {
    for (const as of [
      () => actAs(farm, 'helper'),
      () => actAs(farm, 'inspector'),
      () => actAs(farm, 'owner', { authVia: 'bearer' }),
      () => actAs(farm, 'owner', { impersonating: true })
    ]) {
      as();
      const res = await call(GET, { path: '/api/account/export.zip' });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('INTERACTIVE_OWNER_ONLY');
    }
  });
});
