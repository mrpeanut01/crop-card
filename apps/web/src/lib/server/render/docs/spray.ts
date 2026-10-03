import { RULES_VERSION } from '$lib/safety/version';
import { APP_VERSION } from '$lib/version';
import { CC_TABLE, PAGE, type PdfJobDoc } from '../pdfSpec';
import { signatureFooter } from './parts';

export interface SprayExportDocInput {
  farmName: string;
  generatedDay: string;
  /** The viewer's `identityLabel`. */
  exporter: string;
  filterLine: string;
  signatureText: string;
  recordCount: number;
  integrityHash: string;
  tableBody: unknown[][];
}

/** `/api/spray/records/export.pdf`. */
export function sprayExportDoc(i: SprayExportDocInput): PdfJobDoc {
  return {
    doc: {
      info: {
        title: `CropCard spray records — ${i.farmName}`,
        author: 'CropCard',
        subject: 'Spray-record compliance export',
        creator: `CropCard v${APP_VERSION}`,
        producer: `CropCard v${APP_VERSION}`
      },
      pageSize: 'LETTER',
      pageOrientation: 'landscape',
      pageMargins: [40, 80, 40, 60],
      content: [
        { text: 'CropCard — Spray-record export', style: 'h1' },
        {
          text: `${i.recordCount} record(s) · rules ${RULES_VERSION} · app v${APP_VERSION}`,
          style: 'sub'
        },
        { text: `Integrity hash: ${i.integrityHash}`, style: 'mono', margin: [0, 0, 0, 12] },
        {
          table: {
            headerRows: 1,
            widths: ['auto', 80, 80, '*', '*', 'auto', 'auto'],
            body: i.tableBody
          },
          layout: CC_TABLE
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
        mono: { fontSize: 8, color: '#1f5e3a' },
        farmName: { fontSize: 13, bold: true, color: '#1f5e3a' },
        farmSub: { fontSize: 8, color: '#555555' },
        footer: { fontSize: 8, color: '#777777' }
      },
      defaultStyle: { fontSize: 9, font: 'Roboto' }
    },
    header: {
      first: {
        stack: [
          { text: i.farmName, style: 'farmName' },
          { text: `${i.generatedDay} · ${i.exporter} · ${i.filterLine}`, style: 'farmSub' }
        ],
        margin: [40, 24, 40, 0]
      },
      rest: {
        text: [`${i.farmName} · ${i.generatedDay} · page `, PAGE],
        style: 'farmSub',
        margin: [40, 24, 40, 0]
      }
    },
    footer: signatureFooter(i.signatureText, [40, 0, 40, 24])
  };
}
