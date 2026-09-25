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
