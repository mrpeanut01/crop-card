import { readFileSync, writeFileSync } from "node:fs";
import { extractHoldFactTables } from "../lib/extractHoldFactTables.js";
import { extractHoldWriters } from "../lib/extractHoldWriters.js";
import { holdWriterSources } from "../lib/holdWriterSources.js";

const SCHEMA_URL = new URL(
  "../../../apps/web/src/lib/db/schema.ts",
  import.meta.url,
);
const LIST_URL = new URL("../hold-fact-tables.json", import.meta.url);
const WRITERS_URL = new URL("../hold-writers.json", import.meta.url);

const tables = extractHoldFactTables(readFileSync(SCHEMA_URL, "utf8"));
writeFileSync(LIST_URL, JSON.stringify(tables, null, 2) + "\n");
console.log(`wrote ${tables.length} hold-fact tables to hold-fact-tables.json`);

const { writers } = extractHoldWriters(holdWriterSources(), tables);
writeFileSync(WRITERS_URL, JSON.stringify(writers, null, 2) + "\n");
console.log(`wrote ${writers.length} hold writers to hold-writers.json`);
