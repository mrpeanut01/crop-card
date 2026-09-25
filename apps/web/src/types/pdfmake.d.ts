declare module 'pdfmake' {
  type Style = Record<string, unknown>;

  export interface DocumentDefinition {
    info?: Record<string, string>;
    pageSize?: string;
    pageOrientation?: 'portrait' | 'landscape';
    pageMargins?: number[];
    content: unknown[];
    styles?: Record<string, Style>;
    defaultStyle?: Style;
  }

  type Fonts = Record<
    string,
    { normal: string; bold: string; italics: string; bolditalics: string }
  >;

  interface OutputDocument {
    getBuffer(): Promise<Buffer>;
    getBase64(): Promise<string>;
  }

  interface PdfMake {
    setFonts(fonts: Fonts): void;
    setUrlAccessPolicy(callback: ((url: string) => boolean) | undefined): void;
    setLocalAccessPolicy(callback: ((path: string) => boolean) | undefined): void;
    createPdf(def: DocumentDefinition, options?: Record<string, unknown>): OutputDocument;
  }

  const pdfmake: PdfMake;
  export default pdfmake;
}
