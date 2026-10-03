import { APP_VERSION } from '$lib/version';
import type { Prefs } from '$lib/prefs';
import { PACK_FILES, type PackData } from '$lib/records/organicPack';
import { CC_TABLE, PAGE, type PdfJobDoc } from '../pdfSpec';
import { exportFooter, PDF_STYLES } from './parts';

/** The certifier pack's summary PDF (33B). Built inside the render worker
 *  from data the main thread already loaded. */
export function organicPackSummaryDoc(
  data: PackData,
  opts: { exporter: string; prefs: Prefs; now: Date; withDocuments: boolean }
): PdfJobDoc {
  const th = (text: string) => ({ text, style: 'th' });
  const cell = (text: string | null) => ({ text: text ?? '', style: 'cell' });
  const withStatus = data.statuses.filter((s) => s.inForceToday);
  const needsReview = data.treatments.filter((t) => t.organicOutcome === 'Needs review').length;
  const flagged = data.seed.filter((s) => s.flag).length;
  const title = `${data.farmName} · records from ${data.from} to ${data.to}`;
  return {
    doc: {
      info: {
        title: `Certifier pack ${data.from} to ${data.to}, ${data.farmName}`,
        author: 'CropCard',
        creator: `CropCard v${APP_VERSION}`,
        producer: `CropCard v${APP_VERSION}`
      },
      pageSize: 'LETTER',
      pageOrientation: 'portrait',
      pageMargins: [30, 40, 30, 56],
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
              layout: CC_TABLE
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
          layout: CC_TABLE
        },
        {
          text: 'In every CSV file the first row reads "Prepared from records kept in CropCard. This is not a certification." and the column names are on row 2.',
          style: 'sub',
          margin: [0, 8, 0, 0]
        }
      ],
      styles: PDF_STYLES,
      defaultStyle: { fontSize: 9, font: 'Roboto' }
    },
    header: {
      first: { text: title, style: 'farmSub', margin: [30, 16, 30, 0] },
      rest: { text: [`${title} · page `, PAGE], style: 'farmSub', margin: [30, 16, 30, 0] }
    },
    footer: exportFooter({
      kind: 'pack',
      exporter: opts.exporter,
      prefs: opts.prefs,
      now: opts.now
    })
  };
}
