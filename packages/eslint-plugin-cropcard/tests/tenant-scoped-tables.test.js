import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { extractTenantScopedTables } from '../lib/extractTenantTables.js';

const schemaSource = readFileSync(
  new URL('../../../apps/web/src/lib/db/schema.ts', import.meta.url),
  'utf8'
);
const checkedIn = JSON.parse(
  readFileSync(new URL('../tenant-scoped-tables.json', import.meta.url), 'utf8')
);

describe('tenant-scoped-tables.json', () => {
  it('matches every tenantScoped(...) export in apps/web/src/lib/db/schema.ts', () => {
    assert.deepEqual(
      checkedIn,
      extractTenantScopedTables(schemaSource),
      'Tenant table list drifted from schema.ts — run `pnpm --filter eslint-plugin-cropcard gen:tables` and commit the result.'
    );
  });

  it('is non-trivial (guards against the extractor silently matching nothing)', () => {
    assert.ok(checkedIn.length >= 30);
    assert.ok(checkedIn.includes('blocks'));
    assert.ok(checkedIn.includes('plantingRecords'));
  });
});

describe('extractTenantScopedTables', () => {
  it('collects branded exports and aliases of them, ignoring unbranded tables', () => {
    const src = `
export const users = sqliteTable('users', {});
export const blocks = tenantScoped(
  sqliteTable('blocks', {})
);
export const fooBar = tenantScoped(sqliteTable('foo_bar', {}));
export const plantingRecords = blocks;
export const userAlias = users;
const hidden = tenantScoped(sqliteTable('hidden', {}));
`;
    assert.deepEqual(extractTenantScopedTables(src), ['blocks', 'fooBar', 'plantingRecords']);
  });
});
