/** 33B (B-44, B-50): PDF pieces shared by the treatment log and the
 *  certifier pack summary. Every page carries the footer line. */

import { renderPdf, type PdfDocDefinition } from '$lib/server/pdf';
import { identityLabel } from '$lib/identity';
import { formatInstant, zoneAbbrev, type Prefs } from '$lib/prefs';
import { APP_VERSION } from '$lib/version';
import type { AuthenticatedUser } from '$lib/server/auth';
import {
  TREATMENT_LOG_STATE_LABEL,
  withdrawalText,
  type TreatmentLogRow
} from './animalTreatmentLog';
import { LOG_FOOTER, PACK_PREAMBLE } from './packCsv';

export const PDF_STYLES = {
  h1: { fontSize: 16, bold: true, color: '#1f5e3a', margin: [0, 0, 0, 2] },
  h2: { fontSize: 12, bold: true, color: '#1f5e3a', margin: [0, 10, 0, 4] },
  sub: { fontSize: 9, color: '#555555' },
  body: { fontSize: 9, color: '#333333' },
  empty: { fontSize: 9, italics: true, color: '#888888' },
  th: { color: 'white', bold: true, fontSize: 8 },
  cell: { fontSize: 7.5 },
  farmName: { fontSize: 12, bold: true, color: '#1f5e3a' },
  farmSub: { fontSize: 8, color: '#555555' },
  footer: { fontSize: 7, color: '#555555' },
  notice: { fontSize: 8, bold: true, color: '#333333' }
};

export function tableLayout() {
  return {
    fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
    hLineColor: () => '#cccccc',
    vLineColor: () => '#cccccc'
  };
}

/** The footer every page carries: the preparation line, who exported it
 *  and the page number. `pack` adds "This is not a certification." */
export function exportFooter(opts: {
  kind: 'log' | 'pack';
  viewer: Pick<AuthenticatedUser, 'email' | 'phone'>;
  prefs: Prefs;
  now: Date;
}) {
  const line = opts.kind === 'pack' ? PACK_PREAMBLE : LOG_FOOTER;
  const signature = `CropCard v${APP_VERSION} · ${formatInstant(opts.now, opts.prefs)} ${zoneAbbrev(opts.prefs, opts.now)} · exported by ${identityLabel(opts.viewer)}`;
  return (currentPage: number, pageCount: number) => ({
    stack: [
      { text: line, style: 'notice' },
      {
        columns: [
          { text: signature, style: 'footer' },
          { text: `page ${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' }
        ]
      }
    ],
    margin: [30, 4, 30, 14]
  });
}

function th(text: string) {
  return { text, style: 'th' };
}

function c(text: string | null | undefined) {
  return { text: text ?? '', style: 'cell' };
}

/** The log as a pdfmake table, for the standalone PDF. */
export function treatmentLogTable(rows: readonly TreatmentLogRow[]) {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [48, 52, 46, 70, 52, 50, 46, 44, 40, '*', 50, 70],
      body: [
        [
          th('Given'),
          th('Animal or group'),
          th('Species'),
          th('Product'),
          th('Approval, lot'),
          th('Dose, route'),
          th('Given by, vet'),
          th('Label use'),
          th('Course end'),
          th('Withdrawal'),
          th('Record'),
          th('Organic review')
        ],
        ...rows.map((r) => [
          c(r.date),
          c(r.subject),
          c(r.species),
          c(r.product),
          c([r.approvalNumber, r.lot ? `Lot ${r.lot}` : null].filter(Boolean).join('\n')),
          c([r.dose, r.route].filter(Boolean).join('\n')),
          c([r.givenBy, r.vet ? `Vet: ${r.vet}` : null].filter(Boolean).join('\n')),
          c(r.labelUse),
          c(r.courseEnd),
          c(withdrawalText(r)),
          c([TREATMENT_LOG_STATE_LABEL[r.state], r.enteredLate].filter(Boolean).join('\n')),
          c(r.organicOutcome)
        ])
      ]
    },
    layout: tableLayout()
  };
}

export async function treatmentLogPdf(
  rows: readonly TreatmentLogRow[],
  opts: {
    farmName: string;
    from: string;
    to: string;
    footer: 'log' | 'pack';
    viewer: Pick<AuthenticatedUser, 'email' | 'phone'>;
    prefs: Prefs;
    now?: Date;
  }
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  const docDef: PdfDocDefinition = {
    info: {
      title: `Animal treatment log ${opts.from} to ${opts.to}, ${opts.farmName}`,
      author: 'CropCard',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [30, 40, 30, 50],
    header: (currentPage: number) => ({
      text: `${opts.farmName} · animal treatment log · ${opts.from} to ${opts.to}${currentPage > 1 ? ` · page ${currentPage}` : ''}`,
      style: 'farmSub',
      margin: [30, 16, 30, 0]
    }),
    footer: exportFooter({ kind: opts.footer, viewer: opts.viewer, prefs: opts.prefs, now }),
    content: [
      { text: 'Animal treatment log', style: 'h1' },
      {
        text: `${opts.farmName}. Treatments, vaccines and wormers given from ${opts.from} to ${opts.to}: ${rows.length} dose record(s). Withdrawal dates are the ones the health page shows, at the farm's time zone.`,
        style: 'sub',
        margin: [0, 0, 0, 8]
      },
      rows.length
        ? treatmentLogTable(rows)
        : { text: 'No treatments recorded in this window.', style: 'empty' }
    ],
    styles: PDF_STYLES,
    defaultStyle: { fontSize: 8, font: 'Roboto' }
  };
  return renderPdf(docDef);
}
