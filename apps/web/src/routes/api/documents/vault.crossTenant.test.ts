// @vitest-environment node
/**
 * Byte-level cross-tenant property test for the document vault (33A
 * acceptance). Over random sequences of upload, link, list, read, metadata,
 * delete and wipe across three farms, a request made as one Owner never
 * returns a byte of another Owner's file (every file carries a unique
 * marker, searched for in every response body and in each Owner's export
 * ZIP), every storage key sits under its own Owner's prefix, a wipe leaves
 * the other farms' files byte-identical, and a guessed or replayed id from
 * another farm answers 404.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { db } from '$lib/db/client';
import { documents } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { wipeAllData } from '$lib/db/admin';
import { ownerStoragePrefix } from '$lib/db/documents';
import { vaultStore } from '$lib/server/vault/store';
import { useTestVault } from '$lib/server/vault/testing';
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
import { GET as list, POST as upload } from './+server';
import { DELETE as del, GET as meta } from './[id]/+server';
import { GET as file } from './[id]/file/+server';
import { POST as linkPost } from './[id]/links/+server';
import { GET as exportZip } from '../account/export.zip/+server';

const vault = useTestVault();
afterAll(() => vault.cleanup());

type Op =
  | { t: 'upload'; farm: number; linkBlock: boolean }
  | { t: 'link'; farm: number; doc: number }
  | { t: 'list'; farm: number; role: 'owner' | 'helper' | 'inspector' }
  | { t: 'read'; farm: number; doc: number; role: 'owner' | 'helper' | 'inspector' }
  | { t: 'meta'; farm: number; doc: number }
  | { t: 'delete'; farm: number; doc: number }
  | { t: 'wipe'; farm: number }
  | { t: 'export'; farm: number };

const farmIdx = fc.integer({ min: 0, max: 2 });
const docIdx = fc.nat({ max: 40 });
const role = fc.constantFrom('owner' as const, 'helper' as const, 'inspector' as const);
const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('upload' as const),
      farm: farmIdx,
      linkBlock: fc.boolean()
    })
  },
  fc.record({ t: fc.constant('link' as const), farm: farmIdx, doc: docIdx }),
  fc.record({ t: fc.constant('list' as const), farm: farmIdx, role }),
  {
    weight: 3,
    arbitrary: fc.record({ t: fc.constant('read' as const), farm: farmIdx, doc: docIdx, role })
  },
  fc.record({ t: fc.constant('meta' as const), farm: farmIdx, doc: docIdx }),
  fc.record({ t: fc.constant('delete' as const), farm: farmIdx, doc: docIdx }),
  { weight: 1, arbitrary: fc.record({ t: fc.constant('wipe' as const), farm: farmIdx }) },
  fc.record({ t: fc.constant('export' as const), farm: farmIdx })
);

interface Uploaded {
  id: string;
  farm: number;
  marker: string;
}

async function filesOnDisk(dir: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join('/'), await readFile(p));
    }
  }
  await walk(dir);
  return out;
}

function allStorageKeys(): { ownerId: string; key: string }[] {
  unscopedQueryNote('the test checks every farm’s storage keys against their owners');
  return db.select({ ownerId: documents.ownerId, key: documents.storageKey }).from(documents).all();
}

describe('document vault, cross-tenant', () => {
  it('never returns another farm’s bytes', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 4, maxLength: 24 }), async (ops) => {
        const farms: TestFarm[] = [seedFarm('xa'), seedFarm('xb'), seedFarm('xc')];
        const uploaded: Uploaded[] = [];
        let seq = 0;
        const foreignMarkers = (i: number) =>
          uploaded.filter((u) => u.farm !== i).map((u) => u.marker);
        const assertClean = (i: number, body: Uint8Array) => {
          for (const m of foreignMarkers(i)) expect(contains(body, m)).toBe(false);
        };
        const pick = (n: number) => (uploaded.length ? uploaded[n % uploaded.length] : null);

        for (const o of ops) {
          const farm = farms[o.farm];
          switch (o.t) {
            case 'upload': {
              actAs(farm, 'owner');
              const marker = `MARK-${o.farm}-${seq++}-${Math.random().toString(36).slice(2)}`;
              const res = await call(upload, {
                method: 'POST',
                query: {
                  kind: 'lab-report',
                  name: `${marker}.pdf`,
                  ...(o.linkBlock ? { subjectType: 'block', subjectId: farm.blockId } : {})
                },
                body: uniquePdf(marker)
              });
              const body = await bytesOf(res);
              assertClean(o.farm, body);
              if (res.status === 201) {
                const doc = JSON.parse(Buffer.from(body).toString()).document as DocumentMeta;
                uploaded.push({ id: doc.id, farm: o.farm, marker });
              } else {
                expect(res.status).toBe(400);
              }
              break;
            }
            case 'link': {
              const u = pick(o.doc);
              if (!u) break;
              actAs(farm, 'owner');
              const res = await call(linkPost, {
                method: 'POST',
                params: { id: u.id },
                json: { subjectType: 'field', subjectId: farm.fieldId }
              });
              assertClean(o.farm, await bytesOf(res));
              if (u.farm !== o.farm) expect(res.status).toBe(404);
              break;
            }
            case 'list': {
              actAs(farm, o.role);
              const res = await call(list);
              expect(res.status).toBe(200);
              const body = await bytesOf(res);
              assertClean(o.farm, body);
              const ids = (
                JSON.parse(Buffer.from(body).toString()).documents as DocumentMeta[]
              ).map((d) => d.id);
              for (const u of uploaded.filter((x) => x.farm !== o.farm)) {
                expect(ids).not.toContain(u.id);
              }
              break;
            }
            case 'read': {
              const u = pick(o.doc);
              if (!u) break;
              actAs(farm, o.role);
              const res = await call(file, { params: { id: u.id } });
              const body = await bytesOf(res);
              assertClean(o.farm, body);
              if (u.farm !== o.farm) expect(res.status).toBe(404);
              else if (res.status === 200) expect(contains(body, u.marker)).toBe(true);
              break;
            }
            case 'meta': {
              const u = pick(o.doc);
              if (!u) break;
              actAs(farm, 'owner');
              const res = await call(meta, { params: { id: u.id } });
              assertClean(o.farm, await bytesOf(res));
              if (u.farm !== o.farm) expect(res.status).toBe(404);
              break;
            }
            case 'delete': {
              const u = pick(o.doc);
              if (!u) break;
              actAs(farm, 'owner');
              const res = await call(del, { method: 'DELETE', params: { id: u.id } });
              assertClean(o.farm, await bytesOf(res));
              if (u.farm !== o.farm) expect(res.status).toBe(404);
              break;
            }
            case 'wipe': {
              const before = await filesOnDisk(vault.dir);
              const prefix = ownerStoragePrefix(farm.ownerId);
              runWithTenant(farm.ownerId, () => wipeAllData());
              await vaultStore()!.deletePrefix(prefix);
              const after = await filesOnDisk(vault.dir);
              for (const [key, bytes] of before) {
                if (key.startsWith(prefix)) {
                  expect(after.has(key)).toBe(false);
                } else {
                  expect(Buffer.from(after.get(key) ?? []).equals(Buffer.from(bytes))).toBe(true);
                }
              }
              break;
            }
            case 'export': {
              actAs(farm, 'owner');
              const res = await call(exportZip, { path: '/api/account/export.zip' });
              expect(res.status).toBe(200);
              const body = await bytesOf(res);
              assertClean(o.farm, body);
              const entries = readZip(body);
              expect(entries.has('export.json')).toBe(true);
              break;
            }
          }
        }

        const allRows = allStorageKeys();
        for (const f of farms) {
          const rows = allRows.filter((r) => r.ownerId === f.ownerId);
          for (const r of rows) expect(r.key.startsWith(ownerStoragePrefix(f.ownerId))).toBe(true);
        }
        const onDisk = await filesOnDisk(vault.dir);
        for (const key of onDisk.keys()) {
          if (!key.startsWith('owners/')) continue;
          const owner = key.split('/')[1];
          const row = allRows.find((r) => r.key === key);
          if (row) expect(row.ownerId).toBe(owner);
        }
      }),
      { numRuns: 25 }
    );
  });
});
