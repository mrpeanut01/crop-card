import { readFileSync, writeFileSync } from 'node:fs';
import { extractTenantScopedTables } from '../lib/extractTenantTables.js';

const SCHEMA_URL = new URL('../../../apps/web/src/lib/db/schema.ts', import.meta.url);
const LIST_URL = new URL('../tenant-scoped-tables.json', import.meta.url);

const tables = extractTenantScopedTables(readFileSync(SCHEMA_URL, 'utf8'));
writeFileSync(LIST_URL, JSON.stringify(tables, null, 2) + '\n');
console.log(`wrote ${tables.length} tenant-scoped tables to tenant-scoped-tables.json`);
