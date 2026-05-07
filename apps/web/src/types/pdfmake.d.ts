declare module 'pdfmake' {
  type Style = Record<string, unknown>;

  interface DocumentDefinition {
    info?: Record<string, string>;
    pageSize?: string;
    pageOrientation?: 'portrait' | 'landscape';
    pageMargins?: number[];
    content: unknown[];
    styles?: Record<string, Style>;
    defaultStyle?: Style;
  }

  interface PdfDoc {
    on(event: 'data', cb: (chunk: Buffer) => void): this;
    on(event: 'end', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    end(): void;
  }

  type Fonts = Record<
    string,
    { normal: string; bold: string; italics: string; bolditalics: string }
  >;

  class PdfPrinter {
    constructor(fonts: Fonts);
    createPdfKitDocument(def: DocumentDefinition): PdfDoc;
  }

  export = PdfPrinter;
}
