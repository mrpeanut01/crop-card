/**
 * Tests only (R-03). Today's function-based pdfmake builders, copied
 * unchanged from the spray, VDACS and year-summary routes, the treatment
 * log and the certifier pack summary before they moved to `PdfJobDoc`.
 * The equivalence test renders these and the new builders from the same
 * data and compares the bytes. Never import this from app code.
 */

import pdfmake, { type DocumentDefinition } from 'pdfmake';
import { RULES_VERSION } from '$lib/safety/version';
import { APP_VERSION } from '$lib/version';
import { identityLabel } from '$lib/identity';
import { formatInstant, formatQuantity, unitLabel, zoneAbbrev, type Prefs } from '$lib/prefs';
import { LATE_LEGEND } from '$lib/records/lateLabel';
import { headCountText, type YearAnimalSection } from '$lib/records/yearSummaryAnimals';
import type { YearSummaryForViewer } from '$lib/records/yearSummary';
import {
  TREATMENT_LOG_STATE_LABEL,
  withdrawalText,
  type TreatmentLogRow
} from '$lib/records/animalTreatmentLog';
import { LOG_FOOTER, PACK_PREAMBLE } from '$lib/records/packCsv';
import { PACK_FILES, type PackData } from '$lib/records/organicPack';

export type PdfDocDefinition = DocumentDefinition & {
  header?: (currentPage: number, pageCount: number) => unknown;
  footer?: (currentPage: number, pageCount: number) => unknown;
};

type Viewer = { email: string | null; phone: string | null };

const STANDARD_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique'
]);

export function renderReference(docDef: PdfDocDefinition): Promise<Buffer> {
  pdfmake.setFonts({
    Roboto: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique'
    }
  });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));
  return pdfmake.createPdf(docDef).getBuffer();
}

// ── /api/spray/records/export.pdf ─────────────────────────────────────────

export function sprayExportDocV0(i: {
  farmName: string;
  generatedDay: string;
  user: Viewer;
  filterLine: string;
  signatureText: string;
  events: { length: number };
  integrityHash: string;
  tableBody: unknown[][];
}): PdfDocDefinition {
  const { farmName, generatedDay, user, filterLine, signatureText, events, integrityHash } = i;
  const tableBody = i.tableBody;
  const docDef: PdfDocDefinition = {
    info: {
      title: `CropCard spray records — ${farmName}`,
      author: 'CropCard',
      subject: 'Spray-record compliance export',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [40, 80, 40, 60],
    header: (currentPage: number) => {
      if (currentPage === 1) {
        return {
          stack: [
            { text: farmName, style: 'farmName' },
            {
              text: `${generatedDay} · ${identityLabel(user)} · ${filterLine}`,
              style: 'farmSub'
            }
          ],
          margin: [40, 24, 40, 0]
        };
      }
      return {
        text: `${farmName} · ${generatedDay} · page ${currentPage}`,
        style: 'farmSub',
        margin: [40, 24, 40, 0]
      };
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: signatureText, style: 'footer' },
        { text: `page ${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' }
      ],
      margin: [40, 0, 40, 24]
    }),
    content: [
      { text: 'CropCard — Spray-record export', style: 'h1' },
      {
        text: `${events.length} record(s) · rules ${RULES_VERSION} · app v${APP_VERSION}`,
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
          widths: ['auto', 80, 80, '*', '*', 'auto', 'auto'],
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
      mono: { fontSize: 8, color: '#1f5e3a' },
      farmName: { fontSize: 13, bold: true, color: '#1f5e3a' },
      farmSub: { fontSize: 8, color: '#555555' },
      footer: { fontSize: 8, color: '#777777' }
    },
    defaultStyle: { fontSize: 9, font: 'Roboto' }
  };
  return docDef;
}

// ── /api/records/export.vdacs.pdf ─────────────────────────────────────────

export function vdacsDocV0(i: {
  farmName: string;
  generatedDay: string;
  user: Viewer;
  filterLine: string;
  signatureText: string;
  unified: { length: number };
  integrityHash: string;
  tableBody: unknown[][];
}): PdfDocDefinition {
  const { farmName, generatedDay, user, filterLine, signatureText, unified, integrityHash } = i;
  const tableBody = i.tableBody;
  const docDef: PdfDocDefinition = {
    info: {
      title: `CropCard VDACS audit pack — ${farmName}`,
      author: 'CropCard',
      subject: 'VDACS pesticide-record compliance export',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [40, 80, 40, 60],
    header: (currentPage: number) => {
      if (currentPage === 1) {
        return {
          stack: [
            { text: farmName, style: 'farmName' },
            {
              text: `VDACS audit pack · ${generatedDay} · ${identityLabel(user)} · ${filterLine}`,
              style: 'farmSub'
            }
          ],
          margin: [40, 24, 40, 0]
        };
      }
      return {
        text: `${farmName} · VDACS audit · ${generatedDay} · page ${currentPage}`,
        style: 'farmSub',
        margin: [40, 24, 40, 0]
      };
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: signatureText, style: 'footer' },
        { text: `page ${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' }
      ],
      margin: [40, 0, 40, 24]
    }),
    content: [
      { text: 'VDACS audit pack', style: 'h1' },
      {
        text: `${unified.length} record(s) — spray/insecticide/fungicide + harvest/hay/decon/fertility · rules ${RULES_VERSION} · app v${APP_VERSION}`,
        style: 'sub'
      },
      {
        text: `Integrity hash: ${integrityHash}`,
        style: 'mono',
        margin: [0, 0, 0, 12]
      },
      {
        text: `Integrity verification: the hash above is a SHA-256 of the canonical row set (kind, id, occurrence time, block, rules version, and each record's plugin hashes). Re-exporting the same records reproduces the same hash; any change to a record after the FR-09 lock alters it. Each record also carries per-plugin content hashes so an individual application can be checked against the plugin version that produced it.`,
        style: 'sub',
        margin: [0, 0, 0, 12]
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 55, 55, '*', 45, 80, 65, 'auto', 80, 'auto'],
          body: tableBody
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
          hLineColor: () => '#cccccc',
          vLineColor: () => '#cccccc'
        }
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
      th: { color: 'white', bold: true, fontSize: 9 },
      kind: { fontSize: 9, bold: true, color: '#1f5e3a' },
      mono: { fontSize: 8, color: '#1f5e3a' },
      farmName: { fontSize: 13, bold: true, color: '#1f5e3a' },
      farmSub: { fontSize: 8, color: '#555555' },
      footer: { fontSize: 8, color: '#777777' }
    },
    defaultStyle: { fontSize: 9, font: 'Roboto' }
  };
  return docDef;
}

// ── /api/records/year-summary.pdf ─────────────────────────────────────────

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtArea(acres: number, prefs: Prefs): string {
  return formatQuantity(acres, 'area', prefs, { digits: 2, bare: true });
}

function fmtMoisture(m: { min: number | null; max: number | null; mean: number | null }): string {
  if (m.mean === null) return '—';
  return `${m.min}% / ${m.mean}% / ${m.max}%`;
}

function tableLayout() {
  return {
    fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
    hLineColor: () => '#cccccc',
    vLineColor: () => '#cccccc'
  };
}

function animalTh(text: string) {
  return { text, style: 'th' };
}

function animalTable(
  widths: (string | number)[],
  header: string[],
  rows: string[][],
  empty: string
) {
  if (rows.length === 0) return { text: empty, style: 'empty' };
  return {
    table: { headerRows: 1, widths, body: [header.map(animalTh), ...rows] },
    layout: tableLayout()
  };
}

export function animalSectionPdfV0(
  a: YearAnimalSection,
  year: number,
  fmtDate: (ms: number) => string
): unknown[] {
  const name = (id: string) => a.speciesNames[id] ?? 'Unknown species';
  return [
    { text: 'Animals', style: 'h2', margin: [0, 14, 0, 0] },
    { text: 'From records on file.', style: 'sub', margin: [0, 0, 0, 4] },
    { text: 'Head count', style: 'body', bold: true, margin: [0, 4, 0, 2] },
    animalTable(
      ['*', 'auto', 'auto'],
      ['Species', `Start of ${year}`, `End of ${year}`],
      a.headCounts.map((h) => [
        name(h.speciesId),
        headCountText(h.atStart),
        headCountText(h.atEnd)
      ]),
      'No animals on file this year.'
    ),
    { text: 'Arrivals and departures', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    animalTable(
      ['*', '*', 'auto'],
      ['Species', 'What happened', 'Head'],
      a.movements.map((m) => [name(m.speciesId), m.label, headCountText(m.head)]),
      'No arrivals or departures recorded this year.'
    ),
    { text: 'Treatments by product', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    animalTable(
      ['*', 'auto', '*'],
      ['Product', 'Doses', 'Given to'],
      a.treatments.map((t) => [t.product, String(t.doses), t.subjects.join(', ')]),
      'No treatments, vaccines or wormers recorded this year.'
    ),
    { text: 'Eggs and milk', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    animalTable(
      ['auto', '*', 'auto', 'auto'],
      ['Food', 'Use', 'Total', 'Logs'],
      a.production.map((p) => [
        p.food === 'eggs' ? 'Eggs' : 'Milk',
        p.useLabel,
        `${p.quantity} ${p.unit}`,
        String(p.logs)
      ]),
      'No eggs or milk logged this year.'
    ),
    { text: 'Food or sales inside a hold', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    animalTable(
      ['auto', '*', '*', '*'],
      ['Date', 'Animal or group', 'What', 'Hold'],
      a.covered.map((c) => [
        fmtDate(c.atMs),
        c.subject,
        `${c.what}, ${c.use.toLowerCase()}`,
        c.basisText
      ]),
      'No food or sale on file fell inside a hold this year.'
    )
  ];
}

export function yearSummaryDocV0(i: {
  year: number;
  farmName: string;
  today: string;
  user: Viewer;
  now: Date;
  prefs: Prefs;
  summary: YearSummaryForViewer;
  philosophyLabel: string;
}): PdfDocDefinition {
  const { year, farmName, today, user, now, prefs, summary, philosophyLabel } = i;
  const areaHeader = `Area treated (${unitLabel('area', prefs)})`;
  const inputCosts = summary.inputCosts;
  const signatureText = `Generated by CropCard v${APP_VERSION} on ${formatInstant(now, prefs)} ${zoneAbbrev(prefs, now)} · exported by ${identityLabel(user)}`;

  const productBody: unknown[][] = [
    [
      { text: 'Product', style: 'th' },
      { text: 'Class(es)', style: 'th' },
      { text: 'Applications', style: 'th' },
      { text: areaHeader, style: 'th' }
    ],
    ...summary.productAcreage.map((p) => [
      p.displayName,
      p.classes.join(', ') || '—',
      String(p.applicationCount),
      fmtArea(p.acresTreated, prefs)
    ])
  ];

  const classBody: unknown[][] = [
    [
      { text: 'Chemistry class', style: 'th' },
      { text: 'Applications', style: 'th' },
      { text: areaHeader, style: 'th' }
    ],
    ...summary.chemistryClassAcreage.map((c) => [
      c.className,
      String(c.applicationCount),
      fmtArea(c.acresTreated, prefs)
    ])
  ];

  const harvestBody: unknown[][] = [
    [
      { text: 'Archetype', style: 'th' },
      { text: 'Crops', style: 'th' },
      { text: 'Events', style: 'th' },
      { text: 'Moisture (min/mean/max)', style: 'th' }
    ],
    ...summary.harvestByArchetype.map((h) => [
      h.archetype,
      String(h.cropCount),
      String(h.eventCount),
      fmtMoisture(h.moisture)
    ])
  ];

  const costBody: unknown[][] | null = inputCosts
    ? [
        [
          { text: 'Category', style: 'th' },
          { text: 'Inferred spend', style: 'th' }
        ],
        ...inputCosts.lines.map((l) => [l.category, fmtCents(l.costCents)]),
        [
          { text: 'Total', bold: true },
          { text: fmtCents(inputCosts.totalCents), bold: true }
        ]
      ]
    : null;

  const docDef: PdfDocDefinition = {
    info: {
      title: `CropCard year-end summary ${year} — ${farmName}`,
      author: 'CropCard',
      subject: 'Year-end summary report (UC-46)',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'portrait',
    pageMargins: [40, 70, 40, 50],
    header: (currentPage: number) => {
      if (currentPage === 1) {
        return {
          stack: [
            { text: `${farmName} — ${year} year in review`, style: 'farmName' },
            {
              text: `${today} · ${identityLabel(user)}`,
              style: 'farmSub'
            }
          ],
          margin: [40, 20, 40, 0]
        };
      }
      return {
        text: `${farmName} · ${year} · page ${currentPage}`,
        style: 'farmSub',
        margin: [40, 20, 40, 0]
      };
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: signatureText, style: 'footer' },
        { text: `page ${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' }
      ],
      margin: [40, 0, 40, 20]
    }),
    content: [
      { text: `Year-end summary — ${year}`, style: 'h1' },
      {
        text: `${summary.totals.totalApplications} application(s) · ${summary.totals.harvestEvents} harvest event(s) · ${summary.totals.blocksTreated} block(s) treated · rules ${RULES_VERSION} · app v${APP_VERSION}`,
        style: 'sub',
        margin: [0, 0, 0, 12]
      },

      { text: 'Applications by product', style: 'h2' },
      summary.productAcreage.length
        ? {
            table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: productBody },
            layout: tableLayout()
          }
        : { text: 'No applications recorded this year.', style: 'empty' },

      { text: 'Applications by chemistry class', style: 'h2', margin: [0, 14, 0, 0] },
      summary.chemistryClassAcreage.length
        ? {
            table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: classBody },
            layout: tableLayout()
          }
        : { text: 'No chemistry classes recorded.', style: 'empty' },

      { text: 'Philosophy compliance', style: 'h2', margin: [0, 14, 0, 0] },
      {
        text: `Evaluated against: ${philosophyLabel}. ${summary.philosophy.compliantApplications} compliant · ${summary.philosophy.nonCompliantApplications} non-compliant · ${summary.philosophy.unknownApplications} unclassified (of ${summary.philosophy.totalApplications} total).`,
        style: 'body'
      },

      { text: 'Harvest by archetype', style: 'h2', margin: [0, 14, 0, 0] },
      summary.harvestByArchetype.length
        ? {
            table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: harvestBody },
            layout: tableLayout()
          }
        : { text: 'No harvest events recorded this year.', style: 'empty' },

      ...(inputCosts && costBody
        ? [
            { text: 'Input costs', style: 'h2', margin: [0, 14, 0, 0] },
            inputCosts.lines.length
              ? {
                  table: { headerRows: 1, widths: ['*', 'auto'], body: costBody },
                  layout: tableLayout()
                }
              : {
                  text: 'No priced consumption recorded (lot costs may be missing).',
                  style: 'empty'
                }
          ]
        : []),

      { text: 'Scout → spray funnel', style: 'h2', margin: [0, 14, 0, 0] },
      {
        text: `${summary.scoutFunnel.scoutObservations} scout observation(s) · ${summary.scoutFunnel.thresholdTriggeredApplications} threshold-triggered application(s) · ${summary.scoutFunnel.spraysAvoided} spray(s) avoided (observation with no follow-up application within 14 days).`,
        style: 'body'
      },

      { text: 'Decon + calibration compliance', style: 'h2', margin: [0, 14, 0, 0] },
      {
        text: `${summary.compliance.calibratedSprayerCount} of ${summary.compliance.sprayerCount} sprayer(s) calibrated · ${summary.compliance.calibratedThisYear} calibrated this year · ${summary.compliance.deconEventsThisYear} decon event(s) this year.`,
        style: 'body'
      },

      ...(summary.animals
        ? animalSectionPdfV0(summary.animals, year, (ms) => formatInstant(ms, prefs, 'date'))
        : []),

      {
        text: '\nDeterministic aggregate — read-only over recorded events. Retention: minimum 2 years from occurrence (NFR-05). Records are immutable after the 48-hour lock window (FR-09).',
        style: 'sub',
        margin: [0, 16, 0, 0]
      }
    ],
    styles: {
      h1: { fontSize: 18, bold: true, color: '#1f5e3a', margin: [0, 0, 0, 2] },
      h2: { fontSize: 12, bold: true, color: '#1f5e3a', margin: [0, 8, 0, 4] },
      sub: { fontSize: 9, color: '#555555' },
      body: { fontSize: 10, color: '#333333' },
      empty: { fontSize: 9, italics: true, color: '#888888' },
      th: { color: 'white', bold: true, fontSize: 9 },
      farmName: { fontSize: 13, bold: true, color: '#1f5e3a' },
      farmSub: { fontSize: 8, color: '#555555' },
      footer: { fontSize: 7, color: '#777777' }
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' }
  };
  return docDef;
}

// ── lib/records/treatmentLogPdf.server.ts ─────────────────────────────────

export const PDF_STYLES_V0 = {
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

export function exportFooterV0(opts: {
  kind: 'log' | 'pack';
  viewer: Viewer;
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

export function treatmentLogTableV0(rows: readonly TreatmentLogRow[]) {
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

export function treatmentLogDocV0(
  rows: readonly TreatmentLogRow[],
  opts: {
    farmName: string;
    from: string;
    to: string;
    footer: 'log' | 'pack';
    viewer: Viewer;
    prefs: Prefs;
    now?: Date;
  }
): PdfDocDefinition {
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
    footer: exportFooterV0({ kind: opts.footer, viewer: opts.viewer, prefs: opts.prefs, now }),
    content: [
      { text: 'Animal treatment log', style: 'h1' },
      {
        text: `${opts.farmName}. Treatments, vaccines and wormers given from ${opts.from} to ${opts.to}: ${rows.length} dose record(s). Withdrawal dates are the ones the health page shows, at the farm's time zone.`,
        style: 'sub',
        margin: [0, 0, 0, 8]
      },
      rows.length
        ? treatmentLogTableV0(rows)
        : { text: 'No treatments recorded in this window.', style: 'empty' }
    ],
    styles: PDF_STYLES_V0,
    defaultStyle: { fontSize: 8, font: 'Roboto' }
  };
  return docDef;
}

// ── lib/server/organicPack.ts organicPackSummaryPdf ───────────────────────

export function organicPackSummaryDocV0(
  data: PackData,
  opts: { viewer: Viewer; prefs: Prefs; now: Date; withDocuments: boolean }
): PdfDocDefinition {
  const th = (text: string) => ({ text, style: 'th' });
  const cell = (text: string | null) => ({ text: text ?? '', style: 'cell' });
  const withStatus = data.statuses.filter((s) => s.inForceToday);
  const needsReview = data.treatments.filter((t) => t.organicOutcome === 'Needs review').length;
  const flagged = data.seed.filter((s) => s.flag).length;
  const docDef: PdfDocDefinition = {
    info: {
      title: `Certifier pack ${data.from} to ${data.to}, ${data.farmName}`,
      author: 'CropCard',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'portrait',
    pageMargins: [30, 40, 30, 56],
    header: (currentPage: number) => ({
      text: `${data.farmName} · records from ${data.from} to ${data.to}${currentPage > 1 ? ` · page ${currentPage}` : ''}`,
      style: 'farmSub',
      margin: [30, 16, 30, 0]
    }),
    footer: exportFooterV0({ kind: 'pack', viewer: opts.viewer, prefs: opts.prefs, now: opts.now }),
    content: [
      { text: 'Organic records pack', style: 'h1' },
      {
        text: `${data.farmName}. Records from ${data.from} to ${data.to}, prepared ${data.generatedAt}. Every organic status here was entered by the farm owner. CropCard does not decide whether land, animals or crops qualify. Ask your certifier.`,
        style: 'body',
        margin: [0, 0, 0, 6]
      },
      {
        text: `Library marks are read from the plugin library in ${data.libraryBuild} on the day this pack was prepared, not as they read when each record was saved.`,
        style: 'sub',
        margin: [0, 0, 0, 8]
      },
      { text: 'Owner-entered status in force today', style: 'h2' },
      withStatus.length
        ? {
            table: {
              headerRows: 1,
              widths: [50, '*', '*'],
              body: [
                [th('Subject'), th('Name'), th('Status')],
                ...withStatus.map((s) => [
                  cell(s.subjectType),
                  cell(s.area ? `${s.name} (${s.area})` : s.name),
                  cell(s.inForceToday)
                ])
              ]
            },
            layout: tableLayout()
          }
        : { text: 'No organic status is on file for any subject.', style: 'empty' },
      { text: 'What is in this pack', style: 'h2' },
      {
        table: {
          headerRows: 1,
          widths: [130, '*'],
          body: [
            [th('File'), th('Contents')],
            [
              cell(PACK_FILES.statuses),
              cell(
                `${data.statuses.length} row(s): every growing Area, block, animal and group with its status history. A blank status means none is on file.`
              )
            ],
            [cell(PACK_FILES.activity), cell(`${data.activity.length} record(s) in the window.`)],
            [cell(PACK_FILES.inputs), cell(`${data.inputs.length} input(s) used in the window.`)],
            [
              cell(PACK_FILES.seed),
              cell(
                `${data.seed.length} seed lot(s); ${flagged} flagged "No search on file" or "Seed status not recorded".`
              )
            ],
            [
              cell(PACK_FILES.treatments),
              cell(
                `${data.treatments.length} dose record(s)${needsReview ? `; ${needsReview} still need the owner's organic review` : ''}.`
              )
            ],
            [
              cell(PACK_FILES.harvests),
              cell(`${data.harvests.length} row(s) of harvests and where they went.`)
            ],
            [
              cell(PACK_FILES.documents),
              cell(
                `${data.documents.length} linked document(s)${opts.withDocuments ? ', with the files under documents/' : ''}.`
              )
            ]
          ]
        },
        layout: tableLayout()
      },
      {
        text: 'In every CSV file the first row reads "Prepared from records kept in CropCard. This is not a certification." and the column names are on row 2.',
        style: 'sub',
        margin: [0, 8, 0, 0]
      }
    ],
    styles: PDF_STYLES_V0,
    defaultStyle: { fontSize: 9, font: 'Roboto' }
  };
  return docDef;
}
