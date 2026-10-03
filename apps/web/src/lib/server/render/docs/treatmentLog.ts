import { APP_VERSION } from '$lib/version';
import type { Prefs } from '$lib/prefs';
import {
  TREATMENT_LOG_STATE_LABEL,
  withdrawalText,
  type TreatmentLogRow
} from '$lib/records/animalTreatmentLog';
import { CC_TABLE, PAGE, type PdfJobDoc } from '../pdfSpec';
import { exportFooter, PDF_STYLES } from './parts';

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
    layout: CC_TABLE
  };
}

export interface TreatmentLogDocOptions {
  farmName: string;
  from: string;
  to: string;
  footer: 'log' | 'pack';
  /** The viewer's `identityLabel`. */
  exporter: string;
  prefs: Prefs;
  now: Date;
}

/** `/api/animals/treatments.pdf` (33B, B-50). */
export function treatmentLogDoc(
  rows: readonly TreatmentLogRow[],
  opts: TreatmentLogDocOptions
): PdfJobDoc {
  const title = `${opts.farmName} · animal treatment log · ${opts.from} to ${opts.to}`;
  return {
    doc: {
      info: {
        title: `Animal treatment log ${opts.from} to ${opts.to}, ${opts.farmName}`,
        author: 'CropCard',
        creator: `CropCard v${APP_VERSION}`,
        producer: `CropCard v${APP_VERSION}`
      },
      pageSize: 'LETTER',
      pageOrientation: 'landscape',
      pageMargins: [30, 40, 30, 50],
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
    },
    header: {
      first: { text: title, style: 'farmSub', margin: [30, 16, 30, 0] },
      rest: { text: [`${title} · page `, PAGE], style: 'farmSub', margin: [30, 16, 30, 0] }
    },
    footer: exportFooter({
      kind: opts.footer,
      exporter: opts.exporter,
      prefs: opts.prefs,
      now: opts.now
    })
  };
}
