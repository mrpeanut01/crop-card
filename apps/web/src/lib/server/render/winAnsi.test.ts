// @vitest-environment node
/**
 * #746: PDFs use the standard Helvetica fonts, which only draw WinAnsi
 * (Windows-1252) characters; anything else prints as garbage. Every literal
 * in the PDF builders and the code that fills their tables must be
 * encodable.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hayHarvestLine } from '$lib/records/yearSummary';
import { reiText } from '$lib/records/exportFacts';

const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((c) => c.codePointAt(0)!));

function nonWinAnsi(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
    if (cp >= 0x20 && cp <= 0x7e) continue;
    if (cp >= 0xa0 && cp <= 0xff) continue;
    if (CP1252_EXTRA.has(cp)) continue;
    bad.add(ch);
  }
  return [...bad];
}

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const PDF_SOURCES = [
  'src/lib/server/render/docs/yearSummary.ts',
  'src/lib/server/render/docs/vdacs.ts',
  'src/lib/server/render/docs/spray.ts',
  'src/lib/server/render/docs/parts.ts',
  'src/lib/server/render/docs/organicPackSummary.ts',
  'src/lib/server/render/docs/treatmentLog.ts',
  'src/lib/records/treatmentLogPdf.server.ts',
  'src/lib/records/yearSummaryAnimalsPdf.ts',
  'src/lib/records/vdacsColumns.ts',
  'src/lib/records/exportFacts.ts',
  'src/lib/records/pollinatorAttestation.ts',
  'src/routes/api/records/year-summary.pdf/+server.ts',
  'src/routes/api/records/export.vdacs.pdf/+server.ts',
  'src/routes/api/spray/records/export.pdf/+server.ts'
];

describe('PDF text is WinAnsi-encodable (#746)', () => {
  it('the checker flags characters Helvetica cannot draw', () => {
    expect(nonWinAnsi('Scout → spray ≥ 🔒')).toEqual(['→', '≥', '🔒']);
    expect(nonWinAnsi('A · B — C … 12°F é')).toEqual([]);
  });

  for (const file of PDF_SOURCES) {
    it(`${file} has no literal Helvetica cannot draw`, () => {
      const src = withoutComments(readFileSync(resolve(process.cwd(), file), 'utf8'));
      expect(nonWinAnsi(src)).toEqual([]);
    });
  }

  it('generated summary lines are encodable', () => {
    const line = hayHarvestLine({
      cuttingCount: 2,
      blockCount: 1,
      bales: [{ baleType: 'small-square', count: 400 }],
      moisture: { sampleCount: 1, min: 14, max: 14, mean: 14 }
    });
    expect(nonWinAnsi(line + reiText(12) + reiText(undefined))).toEqual([]);
  });
});
