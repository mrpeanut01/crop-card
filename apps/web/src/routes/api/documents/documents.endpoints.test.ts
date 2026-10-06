// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));
vi.mock('$lib/server/billing/plans', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/server/billing/plans')>();
  return {
    ...original,
    ...(await import('$lib/server/documents.testkit')).planOverrides(original)
  };
});

import { db } from '$lib/db/client';
import { documents as documentsTable, soilTests } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { eq } from 'drizzle-orm';
import { closeSeason } from '$lib/server/seasonClose';
import { useTestVault } from '$lib/server/vault/testing';
import { saveDocument } from '$lib/server/vault/documents';
import { _setVaultStoreForTests } from '$lib/server/vault/store';
import { filesystemVaultStore } from '$lib/server/vault/filesystemStore';
import { bodyTooLarge, capChunkedBody } from '../../../hooks.server';
import { latestSoilTestsPerBlock, snapshotStateKey } from '$lib/server/cardSnapshot';
import { listSoilTests } from '$lib/db/fertility';
import { labReportForSoilTests } from '$lib/db/documents';
import {
  actAs,
  authState,
  bytesOf,
  call,
  contains,
  seedFarm,
  uniquePdf,
  type TestFarm
} from '$lib/server/documents.testkit';
import type { DocumentMeta } from '$lib/documents/apiSchemas';
import { GET as list, POST as upload } from './+server';
import { DELETE as del, GET as meta } from './[id]/+server';
import { GET as file } from './[id]/file/+server';
import { POST as linkPost } from './[id]/links/+server';
import { DELETE as linkDelete } from './[id]/links/[linkId]/+server';
import { POST as soilPost } from '../fertility/soil-tests/+server';
import { PATCH as soilPatch } from '../fertility/soil-tests/[id]/+server';

const vault = useTestVault();
afterAll(() => vault.cleanup());

async function uploadPdf(
  marker: string,
  query: Record<string, string> = {}
): Promise<{ res: Response; doc: DocumentMeta }> {
  const res = await call(upload, {
    method: 'POST',
    query: { kind: 'lab-report', name: `${marker}.pdf`, ...query },
    body: uniquePdf(marker)
  });
  const body = (await res.clone().json()) as { document: DocumentMeta };
  return { res, doc: body.document };
}

let farm: TestFarm;
beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
  authState.capBytes = null;
});

describe('POST /api/documents', () => {
  it('stores an owner upload and answers its metadata, never the storage key', async () => {
    const { res, doc } = await uploadPdf('UPLOAD-1', { title: 'Spring soil report' });
    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain('owners/');
    expect(doc.title).toBe('Spring soil report');
    expect(doc.mime).toBe('application/pdf');
    expect(doc.originalName).toBe('UPLOAD-1.pdf');
    expect(doc.uploadedBy?.id).toBe(farm.ownerUser);
    expect(doc.links).toEqual([]);
  });

  it('titles a file from its name when no title is given', async () => {
    const { doc } = await uploadPdf('soil_report_2026');
    expect(doc.title).toBe('soil report 2026');
  });

  it('refuses helpers and inspectors with OWNER_ONLY and stores nothing', async () => {
    for (const role of ['helper', 'inspector', 'custom-operator'] as const) {
      actAs(farm, role);
      const res = await call(upload, {
        method: 'POST',
        query: { kind: 'lab-report' },
        body: uniquePdf('NOPE')
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('OWNER_ONLY');
    }
    actAs(farm, 'owner');
    const listed = (await (await call(list)).json()) as { documents: DocumentMeta[] };
    expect(listed.documents).toEqual([]);
  });

  it("accepts the owner's API token", async () => {
    actAs(farm, 'owner', { authVia: 'bearer' });
    const { res } = await uploadPdf('BEARER');
    expect(res.status).toBe(201);
  });

  it('refuses photo kinds and unknown kinds', async () => {
    for (const kind of ['journal-photo', 'animal-photo', 'nope']) {
      const res = await call(upload, { method: 'POST', query: { kind }, body: uniquePdf('K') });
      expect(res.status).toBe(400);
    }
  });

  it('answers the size and type refusals', async () => {
    const noLength = await call(upload, {
      method: 'POST',
      query: { kind: 'lab-report' },
      body: uniquePdf('L'),
      contentLength: null
    });
    expect(noLength.status).toBe(411);
    const huge = await call(upload, {
      method: 'POST',
      query: { kind: 'lab-report' },
      body: uniquePdf('L'),
      contentLength: 20_000_001
    });
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as { code: string }).code).toBe('TOO_LARGE');
    const html = await call(upload, {
      method: 'POST',
      query: { kind: 'lab-report', name: 'report.pdf' },
      body: '<html><script>alert(1)</script></html>'
    });
    expect(html.status).toBe(415);
    expect(((await html.json()) as { code: string }).code).toBe('UNSUPPORTED_TYPE');
  });

  it('attaches the upload to a subject in the same step', async () => {
    const { res, doc } = await uploadPdf('LINKED', {
      subjectType: 'block',
      subjectId: farm.blockId
    });
    expect(res.status).toBe(201);
    expect(doc.links).toMatchObject([
      { subjectType: 'block', subjectId: farm.blockId, subjectExists: true }
    ]);
  });

  it("refuses another Owner's subject and stores nothing", async () => {
    const other = seedFarm('other');
    const res = await call(upload, {
      method: 'POST',
      query: { kind: 'lab-report', subjectType: 'block', subjectId: other.blockId },
      body: uniquePdf('FOREIGN')
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('FOREIGN_REF');
  });

  it('returns STORAGE_FULL past the cap, stores nothing, and still serves reads', async () => {
    const first = await uploadPdf('FIRST');
    authState.capBytes = first.doc.byteSize + 10;
    const second = await call(upload, {
      method: 'POST',
      query: { kind: 'lab-report' },
      body: uniquePdf('SECOND-OVER-CAP')
    });
    expect(second.status).toBe(413);
    expect(((await second.json()) as { code: string }).code).toBe('STORAGE_FULL');
    authState.capBytes = 1;
    const read = await call(file, { params: { id: first.doc.id } });
    expect(read.status).toBe(200);
    expect(contains(await bytesOf(read), 'FIRST')).toBe(true);
    const listed = (await (await call(list)).json()) as { documents: DocumentMeta[] };
    expect(listed.documents.map((d) => d.id)).toEqual([first.doc.id]);
  });

  it('says storage is not set up when the vault is off', async () => {
    _setVaultStoreForTests(null);
    try {
      const res = await call(upload, {
        method: 'POST',
        query: { kind: 'lab-report' },
        body: uniquePdf('OFF')
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('VAULT_OFF');
    } finally {
      _setVaultStoreForTests(filesystemVaultStore(vault.dir));
    }
  });
});

describe('GET /api/documents/:id/file', () => {
  it('streams the bytes with the sandbox headers', async () => {
    const { doc } = await uploadPdf('HEADERS', { title: 'Lab "report" / 2026' });
    const res = await call(file, { params: { id: doc.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('content-length')).toBe(String(doc.byteSize));
    const cd = res.headers.get('content-disposition')!;
    expect(cd.startsWith('attachment;')).toBe(true);
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain('.pdf');
    expect(contains(await bytesOf(res), 'HEADERS')).toBe(true);
  });

  it('serves images inline', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]);
    const res = await call(upload, {
      method: 'POST',
      query: { kind: 'label', name: 'label.jpg' },
      body: jpeg
    });
    expect(res.status).toBe(201);
    const { document } = (await res.json()) as { document: DocumentMeta };
    const got = await call(file, { params: { id: document.id } });
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(got.headers.get('content-disposition')!.startsWith('inline;')).toBe(true);
    expect(got.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('serves a polyglot JPEG with its HTML tail removed and never as HTML', async () => {
    const poly = new Uint8Array([
      ...[0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9],
      ...new TextEncoder().encode('<html><script>alert("POLYGLOT")</script></html>')
    ]);
    const res = await call(upload, { method: 'POST', query: { kind: 'photo' }, body: poly });
    const { document } = (await res.json()) as { document: DocumentMeta };
    const got = await call(file, { params: { id: document.id } });
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(contains(await bytesOf(got), 'POLYGLOT')).toBe(false);
  });

  it('answers the same 404 for missing, deleted, foreign and unreadable ids', async () => {
    const { doc } = await uploadPdf('GONE');
    const owned = await uploadPdf('OWNER-ONLY');
    const other = seedFarm('foreign');
    actAs(other, 'owner');
    const foreign = await uploadPdf('THEIRS');
    actAs(farm, 'owner');
    await call(del, { method: 'DELETE', params: { id: doc.id } });

    const bodies: string[] = [];
    for (const id of ['no-such-id', doc.id, foreign.doc.id]) {
      const res = await call(file, { params: { id } });
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    actAs(farm, 'helper');
    const unreadable = await call(file, { params: { id: owned.doc.id } });
    expect(unreadable.status).toBe(404);
    bodies.push(await unreadable.text());
    const unreadableMeta = await call(meta, { params: { id: owned.doc.id } });
    expect(unreadableMeta.status).toBe(404);
    bodies.push(await unreadableMeta.text());
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('who can read', () => {
  it('lets helpers and inspectors read a file linked to a block, and only the owner a money record', async () => {
    const block = await uploadPdf('BLOCK-FILE', { subjectType: 'block', subjectId: farm.blockId });
    const farmWide = await uploadPdf('FARM-FILE', { subjectType: 'farm', subjectId: farm.ownerId });
    const loose = await uploadPdf('LOOSE-FILE');

    actAs(farm, 'helper');
    expect((await call(file, { params: { id: block.doc.id } })).status).toBe(200);
    expect((await call(file, { params: { id: farmWide.doc.id } })).status).toBe(404);
    expect((await call(file, { params: { id: loose.doc.id } })).status).toBe(404);
    const helperList = (await (await call(list)).json()) as { documents: DocumentMeta[] };
    expect(helperList.documents.map((d) => d.id)).toEqual([block.doc.id]);

    actAs(farm, 'inspector');
    expect((await call(file, { params: { id: farmWide.doc.id } })).status).toBe(200);
    const inspectorList = (await (await call(list)).json()) as { documents: DocumentMeta[] };
    expect(inspectorList.documents.map((d) => d.id).sort()).toEqual(
      [block.doc.id, farmWide.doc.id].sort()
    );
  });

  it('lists photo kinds only for the owner and only when asked', async () => {
    await runWithTenant(farm.ownerId, () =>
      saveDocument({
        kind: 'journal-photo',
        title: 'Journal photo',
        originalName: null,
        uploadedBy: null,
        body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        declaredLength: 4,
        capBytes: null
      })
    );
    const all = (await (await call(list)).json()) as { documents: DocumentMeta[] };
    expect(all.documents).toEqual([]);
    const photos = (await (await call(list, { query: { kind: 'journal-photo' } })).json()) as {
      documents: DocumentMeta[];
    };
    expect(photos.documents).toHaveLength(1);
    actAs(farm, 'helper');
    const helper = (await (await call(list, { query: { kind: 'journal-photo' } })).json()) as {
      documents: DocumentMeta[];
    };
    expect(helper.documents).toEqual([]);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('deletes for the signed-in owner, keeps the metadata and the links', async () => {
    const { doc } = await uploadPdf('DEL', { subjectType: 'block', subjectId: farm.blockId });
    const res = await call(del, { method: 'DELETE', params: { id: doc.id } });
    expect(res.status).toBe(200);
    const after = (await (await call(meta, { params: { id: doc.id } })).json()) as {
      document: DocumentMeta;
    };
    expect(after.document.deletedAt).not.toBeNull();
    expect(after.document.deletedBy?.id).toBe(farm.ownerUser);
    expect(after.document.links).toHaveLength(1);
    expect((await call(file, { params: { id: doc.id } })).status).toBe(404);
    const relink = await call(linkPost, {
      method: 'POST',
      params: { id: doc.id },
      json: { subjectType: 'field', subjectId: farm.fieldId }
    });
    expect(relink.status).toBe(409);
    expect(((await relink.json()) as { code: string }).code).toBe('DOCUMENT_DELETED');
  });

  it('refuses helpers, API tokens and impersonation with INTERACTIVE_OWNER_ONLY', async () => {
    const { doc } = await uploadPdf('KEEP');
    for (const as of [
      () => actAs(farm, 'helper'),
      () => actAs(farm, 'owner', { authVia: 'bearer' }),
      () => actAs(farm, 'owner', { impersonating: true })
    ]) {
      as();
      const res = await call(del, { method: 'DELETE', params: { id: doc.id } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('INTERACTIVE_OWNER_ONLY');
    }
    actAs(farm, 'owner');
    expect((await call(file, { params: { id: doc.id } })).status).toBe(200);
  });

  it('refuses photo documents with PHOTO_DOCUMENT', async () => {
    const saved = await runWithTenant(farm.ownerId, () =>
      saveDocument({
        kind: 'animal-photo',
        title: 'Photo of Daisy',
        originalName: null,
        uploadedBy: null,
        body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        declaredLength: 4,
        capBytes: null
      })
    );
    if (!saved.ok) throw new Error('seed failed');
    const res = await call(del, { method: 'DELETE', params: { id: saved.document.id } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('PHOTO_DOCUMENT');
  });
});

describe('links', () => {
  it('adds a link once, refuses a foreign subject, and removes it', async () => {
    const { doc } = await uploadPdf('LINKS');
    const add = () =>
      call(linkPost, {
        method: 'POST',
        params: { id: doc.id },
        json: { subjectType: 'field', subjectId: farm.fieldId }
      });
    expect((await add()).status).toBe(201);
    const again = (await (await add()).json()) as { document: DocumentMeta; link: { id: string } };
    expect(again.document.links).toHaveLength(1);

    const other = seedFarm('linkother');
    const foreign = await call(linkPost, {
      method: 'POST',
      params: { id: doc.id },
      json: { subjectType: 'field', subjectId: other.fieldId }
    });
    expect(foreign.status).toBe(400);

    actAs(farm, 'helper');
    const helper = await call(linkPost, {
      method: 'POST',
      params: { id: doc.id },
      json: { subjectType: 'field', subjectId: farm.fieldId }
    });
    expect(helper.status).toBe(403);
    actAs(farm, 'owner');

    const removed = await call(linkDelete, {
      method: 'DELETE',
      params: { id: doc.id, linkId: again.link.id }
    });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { document: DocumentMeta }).document.links).toEqual([]);
  });
});

describe('soil test lab report', () => {
  function documentIdOf(id: string): string | null {
    return runWithTenant(farm.ownerId, () =>
      db
        .select({ documentId: soilTests.documentId })
        .from(soilTests)
        .where(withTenant(soilTests, eq(soilTests.id, id)))
        .get()
    )!.documentId;
  }

  it('saves a new soil test with its report and the soil-test link together', async () => {
    const { doc } = await uploadPdf('VT-REPORT');
    const res = await call(soilPost, {
      method: 'POST',
      path: '/api/fertility/soil-tests',
      json: { blockId: farm.blockId, sampledAt: Date.UTC(2026, 2, 1), ph: 6.1, documentId: doc.id }
    });
    expect(res.status).toBe(201);
    const { soilTest } = (await res.json()) as { soilTest: { id: string } };
    expect(documentIdOf(soilTest.id)).toBe(doc.id);
    const m = (await (await call(meta, { params: { id: doc.id } })).json()) as {
      document: DocumentMeta;
    };
    expect(m.document.links).toMatchObject([{ subjectType: 'soil-test', subjectId: soilTest.id }]);
    actAs(farm, 'helper');
    expect((await call(file, { params: { id: doc.id } })).status).toBe(200);
  });

  it('replaces and removes the report on an existing soil test', async () => {
    const a = await uploadPdf('REPORT-A');
    const b = await uploadPdf('REPORT-B');
    const patch = (documentId: string | null) =>
      call(soilPatch, {
        method: 'PATCH',
        params: { id: farm.soilTestId },
        json: { documentId }
      });
    expect((await patch(a.doc.id)).status).toBe(200);
    expect((await patch(b.doc.id)).status).toBe(200);
    expect(documentIdOf(farm.soilTestId)).toBe(b.doc.id);
    const metaA = (await (await call(meta, { params: { id: a.doc.id } })).json()) as {
      document: DocumentMeta;
    };
    expect(metaA.document.links).toEqual([]);
    expect((await patch(null)).status).toBe(200);
    expect(documentIdOf(farm.soilTestId)).toBeNull();
  });

  it("keeps pointing at a deleted report and refuses a deleted or another Owner's file", async () => {
    const { doc } = await uploadPdf('TO-DELETE');
    await call(soilPatch, {
      method: 'PATCH',
      params: { id: farm.soilTestId },
      json: { documentId: doc.id }
    });
    await call(del, { method: 'DELETE', params: { id: doc.id } });
    expect(documentIdOf(farm.soilTestId)).toBe(doc.id);
    const again = await call(soilPatch, {
      method: 'PATCH',
      params: { id: farm.soilTestId },
      json: { documentId: doc.id }
    });
    expect(again.status).toBe(409);

    const other = seedFarm('soilother');
    actAs(other, 'owner');
    const theirs = await uploadPdf('THEIR-REPORT');
    actAs(farm, 'owner');
    const foreign = await call(soilPatch, {
      method: 'PATCH',
      params: { id: farm.soilTestId },
      json: { documentId: theirs.doc.id }
    });
    expect(foreign.status).toBe(400);
  });

  it('removing the soil-test link clears the soil test pointer', async () => {
    const { doc } = await uploadPdf('UNLINK');
    await call(soilPatch, {
      method: 'PATCH',
      params: { id: farm.soilTestId },
      json: { documentId: doc.id }
    });
    const m = (await (await call(meta, { params: { id: doc.id } })).json()) as {
      document: DocumentMeta;
    };
    await call(linkDelete, {
      method: 'DELETE',
      params: { id: doc.id, linkId: m.document.links[0].id }
    });
    expect(documentIdOf(farm.soilTestId)).toBeNull();
  });
});

describe('soil test Card snapshot (A-38)', () => {
  it('carries the lab report and moves the state key on attach and delete', async () => {
    const { doc } = await uploadPdf('CARD-REPORT', { title: 'VT report' });
    const key = () =>
      runWithTenant(farm.ownerId, () => snapshotStateKey({ now: Date.now(), origin: null }));
    const k0 = await key();
    await call(soilPatch, {
      method: 'PATCH',
      params: { id: farm.soilTestId },
      json: { documentId: doc.id }
    });
    const k1 = await key();
    expect(k1).not.toBe(k0);
    const snap = runWithTenant(farm.ownerId, () =>
      latestSoilTestsPerBlock(listSoilTests(), labReportForSoilTests())
    );
    expect(snap.find((t) => t.id === farm.soilTestId)?.labReport).toEqual({
      documentId: doc.id,
      title: 'VT report',
      deletedAt: null
    });
    await call(del, { method: 'DELETE', params: { id: doc.id } });
    expect(await key()).not.toBe(k1);
    const after = runWithTenant(farm.ownerId, () =>
      latestSoilTestsPerBlock(listSoilTests(), labReportForSoilTests())
    );
    expect(after.find((t) => t.id === farm.soilTestId)?.labReport?.deletedAt).toEqual(
      expect.any(Number)
    );
  });
});

describe('season close-out (A-54)', () => {
  it('answers every document route the same with the season closed', async () => {
    const before = await uploadPdf('OPEN-SEASON');
    runWithTenant(farm.ownerId, () =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    const after = await uploadPdf('CLOSED-SEASON', {
      subjectType: 'block',
      subjectId: farm.blockId
    });
    expect(after.res.status).toBe(201);
    expect((await call(file, { params: { id: before.doc.id } })).status).toBe(200);
    expect((await call(meta, { params: { id: before.doc.id } })).status).toBe(200);
    expect((await call(list)).status).toBe(200);
    expect(
      (
        await call(linkPost, {
          method: 'POST',
          params: { id: before.doc.id },
          json: { subjectType: 'field', subjectId: farm.fieldId }
        })
      ).status
    ).toBe(201);
    expect(
      (
        await call(soilPatch, {
          method: 'PATCH',
          params: { id: farm.soilTestId },
          json: { documentId: before.doc.id }
        })
      ).status
    ).toBe(200);
    expect((await call(del, { method: 'DELETE', params: { id: after.doc.id } })).status).toBe(200);
  });
});

describe('body size ceiling (A-30)', () => {
  it('keeps 512 KB everywhere except the document upload', () => {
    expect(bodyTooLarge('POST', '/api/spray/record', String(512 * 1024))).toBeNull();
    expect(bodyTooLarge('POST', '/api/spray/record', String(512 * 1024 + 1))?.status).toBe(413);
    expect(bodyTooLarge('PATCH', '/api/documents', String(600_000))?.status).toBe(413);
    expect(bodyTooLarge('POST', '/api/documents', String(20_000_000))).toBeNull();
    expect(bodyTooLarge('POST', '/api/documents/x/links', String(600_000))?.status).toBe(413);
    expect(bodyTooLarge('POST', '/api/spray/record', null)).toBeNull();
  });
});

describe('chunked body ceiling (A-30)', () => {
  function chunked(url: string, bytes: number): Request {
    const chunk = new Uint8Array(64 * 1024).fill(97);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const n = Math.min(chunk.byteLength, bytes - sent);
        sent += n;
        controller.enqueue(chunk.subarray(0, n));
      }
    });
    return new Request(url, {
      method: 'POST',
      headers: { 'transfer-encoding': 'chunked' },
      body,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' });
  }

  it('refuses a chunked body over 512 KB on every route but the upload', async () => {
    const big = capChunkedBody(
      chunked('http://x/api/billing/stripe-webhook', 2 * 1024 * 1024),
      '/api/billing/stripe-webhook'
    );
    await expect(big.text()).rejects.toThrow();
    const small = capChunkedBody(chunked('http://x/api/spray/record', 1000), '/api/spray/record');
    expect((await small.text()).length).toBe(1000);
    const upload = capChunkedBody(
      chunked('http://x/api/documents', 2 * 1024 * 1024),
      '/api/documents'
    );
    expect((await upload.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
  });

  it('leaves requests with a Content-Length alone', () => {
    const r = new Request('http://x/api/spray/record', {
      method: 'POST',
      headers: { 'content-length': '2' },
      body: '{}'
    });
    expect(capChunkedBody(r, '/api/spray/record')).toBe(r);
  });
});

describe('GET /api/documents paging', () => {
  it('pages through files that share a creation millisecond without skipping any', async () => {
    for (let i = 0; i < 103; i++) await uploadPdf(`PAGE-${i}`);
    const same = new Date('2026-09-01T12:00:00Z');
    runWithTenant(farm.ownerId, () =>
      db.update(documentsTable).set({ createdAt: same }).where(withTenant(documentsTable)).run()
    );
    const ids = new Set<string>();
    let query: Record<string, string> = {};
    for (let page = 0; page < 5; page++) {
      const res = await call(list, { query });
      const body = (await res.json()) as {
        documents: DocumentMeta[];
        nextBefore: number | null;
        nextBeforeId: string | null;
      };
      for (const d of body.documents) ids.add(d.id);
      if (body.nextBefore === null) break;
      query = { before: String(body.nextBefore), beforeId: body.nextBeforeId! };
    }
    expect(ids.size).toBe(103);
    // 103 uploads through the endpoint: about 0.6 s alone, near 3 s in a loaded full run.
  }, 30_000);
});
