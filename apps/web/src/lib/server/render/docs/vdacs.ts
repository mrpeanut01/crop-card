import { RULES_VERSION } from '$lib/safety/version';
import { APP_VERSION } from '$lib/version';
import { LATE_LEGEND } from '$lib/records/lateLabel';
import { CC_TABLE, PAGE, type PdfJobDoc } from '../pdfSpec';
import { signatureFooter } from './parts';

export interface VdacsDocInput {
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

/** Landscape Letter less the 40 pt side margins. */
export const VDACS_CONTENT_WIDTH = 792 - 40 - 40;

/** Date, Kind, Block / crop, Sprayer, Product, Target, REI, Area / total,
 *  Cond., Applicator, Pollinator, Lock. Every column but Product is fixed,
 *  so a long cell wraps instead of pushing the table off the page (#759). */
export const VDACS_TABLE_WIDTHS: (number | '*')[] = [
  46,
  40,
  58,
  44,
  '*',
  52,
  30,
  60,
  46,
  52,
  54,
  34
];

/** `/api/records/export.vdacs.pdf`. */
export function vdacsDoc(i: VdacsDocInput): PdfJobDoc {
  return {
    doc: {
      info: {
        title: `CropCard VDACS audit pack — ${i.farmName}`,
        author: 'CropCard',
        subject: 'VDACS pesticide-record compliance export',
        creator: `CropCard v${APP_VERSION}`,
        producer: `CropCard v${APP_VERSION}`
      },
      pageSize: 'LETTER',
      pageOrientation: 'landscape',
      pageMargins: [40, 80, 40, 60],
      content: [
        { text: 'VDACS audit pack', style: 'h1' },
        {
          text: `${i.recordCount} record(s) — spray/insecticide/fungicide + harvest/hay/decon/fertility · rules ${RULES_VERSION} · app v${APP_VERSION}`,
          style: 'sub'
        },
        { text: `Integrity hash: ${i.integrityHash}`, style: 'mono', margin: [0, 0, 0, 12] },
        {
          text: `Integrity verification: the hash above is a SHA-256 of the canonical row set (kind, id, occurrence time, block, rules version, and each record's plugin hashes). Re-exporting the same records reproduces the same hash; any change to a record after the FR-09 lock alters it. Each record also carries per-plugin content hashes so an individual application can be checked against the plugin version that produced it.`,
          style: 'sub',
          margin: [0, 0, 0, 12]
        },
        {
          table: {
            headerRows: 1,
            widths: VDACS_TABLE_WIDTHS,
            body: i.tableBody
          },
          layout: CC_TABLE,
          style: 'cell'
        },
        {
          text: 'Applicator certification numbers are not captured by CropCard; write the number beside each applicator when an inspector asks for it.',
          style: 'sub',
          margin: [0, 8, 0, 0]
        },
        {
          text: '\nRetention: minimum 2 years from occurrence (NFR-05). Records are immutable after the 48-hour FR-09 lock window. Plugin hashes embedded per record allow tamper-evident auditing.',
          style: 'sub',
          margin: [0, 16, 0, 0]
        },
        { text: LATE_LEGEND, style: 'sub', margin: [0, 6, 0, 0] }
      ],
      styles: {
        h1: { fontSize: 16, bold: true, color: '#1f5e3a', margin: [0, 0, 0, 4] },
        sub: { fontSize: 9, color: '#555555' },
        th: { color: 'white', bold: true, fontSize: 7.5 },
        cell: { fontSize: 7 },
        kind: { fontSize: 7, bold: true, color: '#1f5e3a' },
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
          {
            text: `VDACS audit pack · ${i.generatedDay} · ${i.exporter} · ${i.filterLine}`,
            style: 'farmSub'
          }
        ],
        margin: [40, 24, 40, 0]
      },
      rest: {
        text: [`${i.farmName} · VDACS audit · ${i.generatedDay} · page `, PAGE],
        style: 'farmSub',
        margin: [40, 24, 40, 0]
      }
    },
    footer: signatureFooter(i.signatureText, [40, 0, 40, 24])
  };
}
