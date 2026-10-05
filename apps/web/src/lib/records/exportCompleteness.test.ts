import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPORT_SOURCES = [
  'src/lib/server/accountExport.ts',
  'src/routes/api/spray/records/export.csv/+server.ts',
  'src/routes/api/spray/records/export.pdf/+server.ts',
  'src/routes/api/spray/records/export.usda.csv/+server.ts',
  'src/routes/api/records/export.vdacs.pdf/+server.ts',
  'src/lib/records/yearSummary.server.ts',
  'src/lib/records/hayExport.server.ts'
];

const LIST_CALL =
  /\b(listSprayEvents|listInsecticideEvents|listFungicideEvents|listScoutObservations|listCuttings|listHarvestEvents)\(\s*(\{[^)]*\})?\s*\)/g;

describe('compliance and GDPR exports read every record in range', () => {
  for (const file of EXPORT_SOURCES) {
    it(`${file} passes no row limit to the record lists`, () => {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      const capped = [...src.matchAll(LIST_CALL)].filter((m) => /\blimit\b/.test(m[2] ?? ''));
      expect(capped.map((m) => m[0])).toEqual([]);
    });
  }
});
