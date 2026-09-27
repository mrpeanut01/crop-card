import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../index.js';
import { extractHoldFactTables } from '../lib/extractHoldFactTables.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const rule = plugin.rules['no-unguarded-hold-write'];

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' }
});

ruleTester.run('no-unguarded-hold-write', rule, {
  valid: [
    `await guardedHoldWrite(event, user, () => applyMove(plan, ctx));`,
    `const g = await tryGuardedHoldWrite(event, user, () => { const r = insertHealthEvent(x); return r; });`,
    `const write = () => insertHarvestEvent(x); await tryGuardedHoldWrite(event, auth, write);`,
    `function write() { return deleteBlockCascade(id); } await guardedHoldWrite(event, u, write);`,
    `return voidRecord(event, target, (input, by) => deleteHealthEvent(r, { deletedBy: by }));`,
    `db.select().from(animalLocations).where(withTenant(animalLocations));`,
    `db.insert(owners).values({ id });`,
    `listLocationsForSubject('animal', id);`,
    `repo.insertStay(x);`
  ],
  invalid: [
    {
      code: `db.insert(sprayEvents).values(tenantValues({}));`,
      errors: [{ messageId: 'rawWrite' }]
    },
    {
      code: `db.update(animalLocations).set({ toMs: null }).where(withTenant(animalLocations));`,
      errors: [{ messageId: 'rawWrite' }]
    },
    {
      code: `db.delete(blocks).where(withTenant(blocks, eq(blocks.id, id)));`,
      errors: [{ messageId: 'rawWrite' }]
    },
    {
      code: `export const POST = async () => { const move = applyMove(plan, ctx); return move; };`,
      errors: [{ messageId: 'unguarded' }]
    },
    {
      code: `writeRecord(event, () => insertHealthEvent(x));`,
      errors: [{ messageId: 'unguarded' }]
    },
    {
      code: `await guardedHoldWrite(event, user, () => 1); deleteHealthEvent(r, opts);`,
      errors: [{ messageId: 'unguarded' }]
    }
  ]
});

describe('hold-fact-tables.json', () => {
  const schemaSource = readFileSync(
    new URL('../../../apps/web/src/lib/db/schema.ts', import.meta.url),
    'utf8'
  );
  const checkedIn = JSON.parse(
    readFileSync(new URL('../hold-fact-tables.json', import.meta.url), 'utf8')
  );

  it('matches every // @hold-fact table in apps/web/src/lib/db/schema.ts', () => {
    assert.deepEqual(
      checkedIn,
      extractHoldFactTables(schemaSource),
      'Hold-fact table list drifted from schema.ts — run `pnpm --filter eslint-plugin-cropcard gen:tables` and commit the result.'
    );
  });

  it('names the tables the hold ledger reads', () => {
    for (const t of [
      'animalLocations',
      'animalHealthEvents',
      'animalProductionLogs',
      'animalStatusEvents',
      'grazingAttestations',
      'sprayEvents',
      'insecticideEvents',
      'fungicideEvents',
      'hayCuttings',
      'harvestEvents',
      'blocks',
      'recordDeletions'
    ]) {
      assert.ok(checkedIn.includes(t), t);
    }
  });

  it('extracts only marked tenant-scoped tables', () => {
    const src = `
// @hold-fact (C-35)
export const a = tenantScoped(sqliteTable('a', {}));
// @hold-fact (C-35)
/** doc */
export const b = tenantScoped(
  sqliteTable('b', {})
);
export const c = tenantScoped(sqliteTable('c', {}));
`;
    assert.deepEqual(extractHoldFactTables(src), ['a', 'b']);
  });
});
