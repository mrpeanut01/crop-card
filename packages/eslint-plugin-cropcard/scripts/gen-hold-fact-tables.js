import { readFileSync, writeFileSync } from 'node:fs';
import { extractHoldFactTables } from '../lib/extractHoldFactTables.js';

const SCHEMA_URL = new URL('../../../apps/web/src/lib/db/schema.ts', import.meta.url);
const LIST_URL = new URL('../hold-fact-tables.json', import.meta.url);

const tables = extractHoldFactTables(readFileSync(SCHEMA_URL, 'utf8'));
writeFileSync(LIST_URL, JSON.stringify(tables, null, 2) + '\n');
console.log(`wrote ${tables.length} hold-fact tables to hold-fact-tables.json`);
