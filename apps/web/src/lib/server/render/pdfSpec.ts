/**
 * Contract C-R1: a pdfmake document as plain, structured-cloneable data, so
 * it can be posted to the render worker (R-02). Header and footer callbacks
 * become content with page-number placeholder objects, and the one table
 * layout every export uses is referred to by name.
 */

import type { DocumentDefinition } from 'pdfmake';

export type PageToken = { $cc: 'page' | 'pages' };
/** pdfmake Content, where a `text` array may hold `PageToken`s. */
export type PdfContent = unknown;

export interface PdfJobDoc {
  doc: Omit<DocumentDefinition, 'header' | 'footer'>;
  header?: { first?: PdfContent; rest: PdfContent };
  footer?: PdfContent;
}

export type MaterializedDocDef = DocumentDefinition & {
  header?: (currentPage: number, pageCount: number) => unknown;
  footer?: (currentPage: number, pageCount: number) => unknown;
};

export const CC_TABLE = 'ccTable';

export const PAGE: PageToken = Object.freeze({ $cc: 'page' }) as PageToken;
export const PAGES: PageToken = Object.freeze({ $cc: 'pages' }) as PageToken;

/** The green-header, grey-line table layout (`layout: 'ccTable'`). */
export function ccTableLayout() {
  return {
    fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
    hLineColor: () => '#cccccc',
    vLineColor: () => '#cccccc'
  };
}

function isPageToken(v: unknown): v is PageToken {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  const cc = (v as { $cc?: unknown }).$cc;
  return keys.length === 1 && (cc === 'page' || cc === 'pages');
}

/** Copies `node`, swapping page tokens inside `text` arrays for numbers and
 *  `layout: 'ccTable'` for the layout functions. A `text` array that holds
 *  only strings after the swap is joined into one string, which is what the
 *  old callbacks wrote (`page ${n} / ${count}`). Plain strings are never
 *  searched, so a name that looks like a token stays as typed. */
function fill(node: unknown, page: number | null, pages: number | null): unknown {
  if (Array.isArray(node)) return node.map((n) => fill(n, page, pages));
  if (!node || typeof node !== 'object') return node;
  if (node instanceof Date) return new Date(node.getTime());
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'text' && Array.isArray(value) && value.some(isPageToken)) {
      if (page === null || pages === null) {
        throw new Error('Page numbers can only be used in a header or footer');
      }
      const parts = value.map((v) =>
        isPageToken(v) ? String(v.$cc === 'page' ? page : pages) : fill(v, page, pages)
      );
      out.text = parts.every((p) => typeof p === 'string') ? parts.join('') : parts;
    } else if (key === 'layout' && value === CC_TABLE && 'table' in (node as object)) {
      out.layout = ccTableLayout();
    } else {
      out[key] = fill(value, page, pages);
    }
  }
  return out;
}

/** Worker side: turns a `PdfJobDoc` back into a pdfmake definition. Each
 *  page gets a fresh copy of the header and footer, as the old callbacks
 *  built a fresh object per page. */
export function materializeDocDef(spec: PdfJobDoc): MaterializedDocDef {
  const def = fill(spec.doc, null, null) as MaterializedDocDef;
  const header = spec.header;
  if (header) {
    def.header = (currentPage: number, pageCount: number) =>
      fill(
        currentPage === 1 && header.first !== undefined ? header.first : header.rest,
        currentPage,
        pageCount
      );
  }
  const footer = spec.footer;
  if (footer !== undefined) {
    def.footer = (currentPage: number, pageCount: number) => fill(footer, currentPage, pageCount);
  }
  return def;
}
