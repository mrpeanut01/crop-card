import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../index.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const rule = plugin.rules['no-raw-tenant-table'];

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' }
});

ruleTester.run('no-raw-tenant-table', rule, {
  valid: [
    `db.select().from(users).where(eq(users.id, id));`,
    `db.insert(owners).values({ id: 'o1' });`,
    `db.select().from(blocks).where(tenantWhere(blocks));`,
    `db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id)));`,
    `db.insert(sprayEvents).values(tenantValues({ blockId: 1 }));`,
    `function crossTenant() {
       unscopedQueryNote('superadmin lookup');
       return db.select().from(blocks);
     }`,
    `db.update(stockLots).set({ qty: 1 }).where(withTenant(stockLots, eq(stockLots.id, id)));`,
    `db.select().from(blocks as unknown as Table);`,
    `db.select().from(seasonCloseouts).where(withTenant(seasonCloseouts, eq(seasonCloseouts.year, 2026)));`,
    `db.insert(wizardDrafts).values(tenantValues({ id: 'd1' }));`,
    `db.select().from(apiTokens).where(eq(apiTokens.tokenHash, h));`,
    `function outer() {
       unscopedQueryNote('sweep across all tenants');
       return ids.map((id) => db.delete(tasks).where(eq(tasks.id, id)));
     }`,
    `function f() {
       const where = () => withTenant(blocks, eq(blocks.id, id));
       return db.select().from(blocks).where(where());
     }`,
    `runWithTenant(o, () => db.select().from(blocks).where(tenantWhere(blocks)));`,
    `const w = tenantWhere(blocks); const rows = db.select().from(blocks).where(w);`,
    `import { tasks as taskRows } from './fixtures'; db.select().from(taskRows);`,
    `import * as repo from './blocks'; db.select().from(repo.blocks);`,
    `import { users as u } from '$lib/db/schema'; db.select().from(u);`,
    `list.from(someArray);`,
    `const x: Array<string> = Array.from(names);`
  ],
  invalid: [
    {
      code: `db.select().from(blocks).where(eq(blocks.id, id));`,
      errors: [{ messageId: 'rawFrom', data: { name: 'blocks' } }]
    },
    {
      code: `const rows: Row[] = await db.select().from(sprayEvents);`,
      errors: [{ messageId: 'rawFrom', data: { name: 'sprayEvents' } }]
    },
    {
      code: `db.insert(sprayEvents).values({ blockId: 1 });`,
      errors: [{ messageId: 'rawInsert', data: { name: 'sprayEvents' } }]
    },
    {
      code: `db.update(stockLots).set({ qty: 1 }).where(eq(stockLots.id, id));`,
      errors: [{ messageId: 'rawUpdate', data: { name: 'stockLots' } }]
    },
    {
      code: `db.delete(tasks).where(eq(tasks.id, id));`,
      errors: [{ messageId: 'rawDelete', data: { name: 'tasks' } }]
    },
    ...[
      'recordDeletions',
      'fungicideEvents',
      'planRevisions',
      'scoutObservations',
      'kernelDryRunLog',
      'wizardSessions',
      'wizardChatMessages',
      'wizardDrafts',
      'seasonCloseouts',
      'plantingRecords'
    ].map((name) => ({
      code: `db.select().from(${name}); db.insert(${name}).values({}); db.update(${name}).set({}); db.delete(${name});`,
      errors: [
        { messageId: 'rawFrom', data: { name } },
        { messageId: 'rawInsert', data: { name } },
        { messageId: 'rawUpdate', data: { name } },
        { messageId: 'rawDelete', data: { name } }
      ]
    })),
    {
      code: `function a() { return db.select().from(blocks).where(tenantWhere(blocks)); }
             function b() { return db.select().from(blocks); }`,
      errors: [{ messageId: 'rawFrom', data: { name: 'blocks' } }]
    },
    {
      code: `function crossTenant() { unscopedQueryNote('superadmin lookup'); }
             const leak = () => db.delete(tasks);`,
      errors: [{ messageId: 'rawDelete', data: { name: 'tasks' } }]
    },
    {
      code: `describe('x', () => {
               it('a', () => db.insert(tasks).values(tenantValues({})));
               it('b', () => db.insert(tasks).values({ ownerId: 'o' }));
             });`,
      errors: [{ messageId: 'rawInsert', data: { name: 'tasks' } }]
    },
    {
      code: `const rows = db.select().from(blocks);
             function f() { return tenantWhere(blocks); }`,
      errors: [{ messageId: 'rawFrom', data: { name: 'blocks' } }]
    },
    {
      code: `function outer() {
               const inner = () => tenantWhere(blocks);
               return inner;
             }
             function other() { return db.update(blocks).set({}); }`,
      errors: [{ messageId: 'rawUpdate', data: { name: 'blocks' } }]
    },
    {
      code: `import { crops as cropsTable } from '$lib/db/schema';
             db.insert(cropsTable).values({ id: 'c1' });`,
      errors: [{ messageId: 'rawInsert', data: { name: 'cropsTable' } }]
    },
    {
      code: `import * as schema from './schema';
             db.select().from(schema.wizardDrafts);`,
      errors: [{ messageId: 'rawFrom', data: { name: 'schema.wizardDrafts' } }]
    },
    {
      code: `// tenantWhere is only mentioned in a comment, never called
             tx.select().from(aiCallLog);
             tx.delete(pluginOverrides);`,
      errors: [
        { messageId: 'rawFrom', data: { name: 'aiCallLog' } },
        { messageId: 'rawDelete', data: { name: 'pluginOverrides' } }
      ]
    }
  ]
});

describe('eslint-plugin-cropcard', () => {
  it('exposes the rule under its public name with flat-config meta', () => {
    assert.equal(plugin.meta.name, 'eslint-plugin-cropcard');
    assert.equal(rule.meta.type, 'problem');
    assert.deepEqual(Object.keys(plugin.rules), ['no-raw-tenant-table']);
  });
});
