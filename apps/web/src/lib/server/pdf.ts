import pdfmake, { type DocumentDefinition } from 'pdfmake';

const STANDARD_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique'
]);

pdfmake.setFonts({
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
});
// Exports never embed remote or on-disk resources; pdfmake 0.3 treats the
// PDF standard font names as local paths, so only those are allowed.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

export type PdfDocDefinition = DocumentDefinition & {
  header?: (currentPage: number, pageCount: number) => unknown;
  footer?: (currentPage: number, pageCount: number) => unknown;
};

export function renderPdf(docDef: PdfDocDefinition): Promise<Buffer> {
  return pdfmake.createPdf(docDef).getBuffer();
}
