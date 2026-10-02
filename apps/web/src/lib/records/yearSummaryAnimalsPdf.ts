/** 33B (plan item 8): the animal section of the year summary PDF, as
 *  pdfmake content. Pure; shown only when the farm has animals (B-53). */

import { headCountText, type YearAnimalSection } from './yearSummaryAnimals';

function th(text: string) {
  return { text, style: 'th' };
}

function layout() {
  return {
    fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
    hLineColor: () => '#cccccc',
    vLineColor: () => '#cccccc'
  };
}

function table(widths: (string | number)[], header: string[], rows: string[][], empty: string) {
  if (rows.length === 0) return { text: empty, style: 'empty' };
  return {
    table: { headerRows: 1, widths, body: [header.map(th), ...rows] },
    layout: layout()
  };
}

export function animalSectionPdf(
  a: YearAnimalSection,
  year: number,
  fmtDate: (ms: number) => string
): unknown[] {
  const name = (id: string) => a.speciesNames[id] ?? 'Unknown species';
  return [
    { text: 'Animals', style: 'h2', margin: [0, 14, 0, 0] },
    { text: 'From records on file.', style: 'sub', margin: [0, 0, 0, 4] },
    { text: 'Head count', style: 'body', bold: true, margin: [0, 4, 0, 2] },
    table(
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
    table(
      ['*', '*', 'auto'],
      ['Species', 'What happened', 'Head'],
      a.movements.map((m) => [name(m.speciesId), m.label, headCountText(m.head)]),
      'No arrivals or departures recorded this year.'
    ),
    { text: 'Treatments by product', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    table(
      ['*', 'auto', '*'],
      ['Product', 'Doses', 'Given to'],
      a.treatments.map((t) => [t.product, String(t.doses), t.subjects.join(', ')]),
      'No treatments, vaccines or wormers recorded this year.'
    ),
    { text: 'Eggs and milk', style: 'body', bold: true, margin: [0, 8, 0, 2] },
    table(
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
    table(
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
