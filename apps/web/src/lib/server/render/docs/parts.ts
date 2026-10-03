import { APP_VERSION } from '$lib/version';
import { formatInstant, zoneAbbrev, type Prefs } from '$lib/prefs';
import { LOG_FOOTER, PACK_PREAMBLE } from '$lib/records/packCsv';
import { PAGE, PAGES, type PdfContent } from '../pdfSpec';

/** "page N / M", right-aligned, as every export footer writes it. */
export function pageOfPages(style = 'footer'): PdfContent {
  return { text: ['page ', PAGE, ' / ', PAGES], style, alignment: 'right' };
}

/** Signature footer of the spray, VDACS and year-summary exports. */
export function signatureFooter(signatureText: string, margin: number[]): PdfContent {
  return {
    columns: [{ text: signatureText, style: 'footer' }, pageOfPages()],
    margin
  };
}

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

/** The footer every treatment log and pack page carries: the preparation
 *  line, who exported it and the page number. `pack` adds "This is not a
 *  certification." `exporter` is the viewer's `identityLabel`. */
export function exportFooter(opts: {
  kind: 'log' | 'pack';
  exporter: string;
  prefs: Prefs;
  now: Date;
}): PdfContent {
  const line = opts.kind === 'pack' ? PACK_PREAMBLE : LOG_FOOTER;
  const signature = `CropCard v${APP_VERSION} · ${formatInstant(opts.now, opts.prefs)} ${zoneAbbrev(opts.prefs, opts.now)} · exported by ${opts.exporter}`;
  return {
    stack: [
      { text: line, style: 'notice' },
      { columns: [{ text: signature, style: 'footer' }, pageOfPages()] }
    ],
    margin: [30, 4, 30, 14]
  };
}
