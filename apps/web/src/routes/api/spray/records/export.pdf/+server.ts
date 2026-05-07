/**
 * GET /api/spray/records/export.pdf
 *
 * Streams a compliance-ready PDF of all spray records (FR-09, NFR-05).
 * Uses pdfmake server-side; no headless browser dependency.
 *
 * The integrity hash on the cover page is a SHA-256 of the canonical record
 * payload — pair with NFR-10 ("Record exports include a digital hash for
 * integrity verification").
 */

import { createHash } from 'node:crypto';
import { type RequestHandler } from '@sveltejs/kit';
import PdfPrinter from 'pdfmake';
import { evaluateLock, listSprayEvents } from '$lib/db/sprayEvents';
import { RULES_VERSION } from '$lib/safety/version';

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

export const GET: RequestHandler = async ({ url }) => {
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const events = listSprayEvents({ limit: 10_000, sprayerId, blockId });
  const generatedAt = new Date();

  const payload = events.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    blockId: e.blockId,
    sprayerId: e.sprayerId,
    products: e.products.map((p) => p.pluginId).sort(),
    rulesVersion: e.rulesVersion,
    pluginHashes: e.pluginHashes
  }));
  const integrityHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  const tableBody: unknown[][] = [
    [
      { text: 'When', style: 'th' },
      { text: 'Block', style: 'th' },
      { text: 'Sprayer', style: 'th' },
      { text: 'Products', style: 'th' },
      { text: 'Conditions', style: 'th' },
      { text: 'Rules', style: 'th' },
      { text: 'State', style: 'th' }
    ]
  ];

  for (const e of events) {
    const locked = evaluateLock(e) !== undefined;
    tableBody.push([
      new Date(e.occurredAt).toISOString().replace('T', ' ').slice(0, 16),
      { text: e.blockId.slice(0, 8) + '…', style: 'mono' },
      { text: e.sprayerId, style: 'mono' },
      e.products.map((p) => p.pluginId).join('\n'),
      `${e.conditions.windMph} mph\n${e.conditions.tempF}°F\n${e.conditions.rainForecastMmNext24h} mm`,
      { text: e.rulesVersion, style: 'mono' },
      [locked ? '🔒 locked' : 'editable', e.customRateOverride ? '\n⚠ custom rate' : ''].join('')
    ]);
  }

  const docDef: Parameters<typeof printer.createPdfKitDocument>[0] = {
    info: {
      title: 'CropCard spray records',
      author: 'CropCard',
      subject: 'Spray-record compliance export',
      creator: 'CropCard',
      producer: 'CropCard'
    },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [40, 60, 40, 60],
    content: [
      { text: 'CropCard — Spray-record export', style: 'h1' },
      {
        text: `Generated ${generatedAt.toISOString()} · ${events.length} record(s) · rules ${RULES_VERSION}`,
        style: 'sub'
      },
      {
        text: `Integrity hash: ${integrityHash}`,
        style: 'mono',
        margin: [0, 0, 0, 12]
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 60, 60, '*', '*', 'auto', 'auto'],
          body: tableBody
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
          hLineColor: () => '#cccccc',
          vLineColor: () => '#cccccc'
        }
      },
      {
        text: '\nRetention: minimum 2 years from occurrence (NFR-05). Records are immutable after the 48-hour lock window (FR-09). Plugin hashes embedded per record allow tamper-evident auditing.',
        style: 'sub',
        margin: [0, 16, 0, 0]
      }
    ],
    styles: {
      h1: { fontSize: 16, bold: true, color: '#1f5e3a', margin: [0, 0, 0, 4] },
      sub: { fontSize: 9, color: '#555555' },
      th: { color: 'white', bold: true, fontSize: 9 },
      mono: { fontSize: 8, color: '#1f5e3a' }
    },
    defaultStyle: { fontSize: 9, font: 'Roboto' }
  };

  const pdfDoc = printer.createPdfKitDocument(docDef);
  const chunks: Buffer[] = [];
  pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
  pdfDoc.end();

  const buffer: Buffer = await new Promise((resolve, reject) => {
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
  });

  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropcard-spray-records-${stamp}.pdf"`
    }
  });
};
