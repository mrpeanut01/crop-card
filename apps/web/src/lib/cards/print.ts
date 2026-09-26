import { cardShortUrl, type CardPrintLayout } from './model';
import { qrPath, type QrPath } from './qr';

export const PRINT_LAYOUTS: {
  id: CardPrintLayout;
  label: string;
  hint: string;
  perPage: number;
}[] = [
  {
    id: 'letter-4up',
    label: 'Letter, 4 per page',
    hint: 'Plain paper; cut on the dashed lines.',
    perPage: 4
  },
  {
    id: 'index-3x5',
    label: '3×5 index card',
    hint: 'Choose 3×5 paper in the print dialog.',
    perPage: 1
  },
  {
    id: 'index-4x6',
    label: '4×6 index card',
    hint: 'Choose 4×6 paper in the print dialog.',
    perPage: 1
  }
];

export const PRINT_HELP =
  'On iPhone, tap Share → Print, then pinch out on the preview to save a PDF. Turn off headers and footers in the print dialog.';

export function perPage(layout: CardPrintLayout): number {
  return PRINT_LAYOUTS.find((l) => l.id === layout)?.perPage ?? 1;
}

export function paginate<T>(items: readonly T[], layout: CardPrintLayout): T[][] {
  const n = perPage(layout);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += n) pages.push(items.slice(i, i + n));
  return pages;
}

export interface PrintLink {
  url: string;
  qr: QrPath;
}

/** The printed QR only ever encodes `${ORIGIN}/c/<key>`; no origin, no QR. */
export function printLinkFor(origin: string | null | undefined, key: string): PrintLink | null {
  const url = cardShortUrl(origin, key);
  return url ? { url, qr: qrPath(url, { ecc: 'M' }) } : null;
}
