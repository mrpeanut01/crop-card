// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { useTestVault } from './testing';
import { vaultStore, type VaultStore } from './store';

const OWNERS = ['owner_a', 'owner_b', 'owner_c'] as const;

type Op =
  | { t: 'put'; owner: number; marker: string }
  | { t: 'delete'; owner: number; pick: number }
  | { t: 'wipe'; owner: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({ t: fc.constant('put' as const), owner: fc.nat(2), marker: fc.uuid() })
  },
  {
    weight: 2,
    arbitrary: fc.record({ t: fc.constant('delete' as const), owner: fc.nat(2), pick: fc.nat(20) })
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('wipe' as const), owner: fc.nat(2) }) }
);

async function read(store: VaultStore, key: string): Promise<string | null> {
  const got = await store.get(key);
  return got ? new Response(got.body).text() : null;
}

describe('vault store: Owner prefixes never cross', () => {
  let vault: ReturnType<typeof useTestVault> | null = null;
  afterEach(async () => {
    await vault?.cleanup();
    vault = null;
  });

  it('keeps every key under its Owner and a wipe leaves other Owners byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 30 }), async (ops) => {
        vault = useTestVault();
        const store = vaultStore()!;
        const model = new Map<string, { owner: string; body: string }>();
        for (const o of ops) {
          const owner = OWNERS[o.owner];
          if (o.t === 'put') {
            const key = `owners/${owner}/${randomUUID()}`;
            const body = `file-of-${owner}-${o.marker}`;
            await store.put(key, new TextEncoder().encode(body), {
              contentType: 'text/csv; charset=utf-8'
            });
            model.set(key, { owner, body });
          } else if (o.t === 'delete') {
            const mine = [...model.keys()].filter((k) => model.get(k)!.owner === owner);
            if (mine.length === 0) continue;
            const key = mine[o.pick % mine.length];
            await store.delete(key);
            model.delete(key);
          } else {
            await store.deletePrefix(`owners/${owner}/`);
            for (const [k, v] of model) if (v.owner === owner) model.delete(k);
          }
        }
        for (const owner of OWNERS) {
          const listed: string[] = [];
          for await (const obj of store.list(`owners/${owner}/`)) {
            expect(obj.key.startsWith(`owners/${owner}/`)).toBe(true);
            listed.push(obj.key);
            const body = await read(store, obj.key);
            expect(body).toBe(model.get(obj.key)?.body);
            expect(body!.startsWith(`file-of-${owner}-`)).toBe(true);
          }
          const expected = [...model].filter(([, v]) => v.owner === owner).map(([k]) => k);
          expect(listed.sort()).toEqual(expected.sort());
        }
        await vault.cleanup();
        vault = null;
      }),
      { numRuns: 40 }
    );
    // 40 fast-check runs against the filesystem store: about 0.8 s alone, past 3 s in a loaded full run.
  }, 30_000);
});
