import { ymdToUtcMs } from './build/common';

export interface CardViewParams {
  /** The day an Area Card's bed map shows (`?on=YYYY-MM-DD`). */
  bedMapOnMs?: number;
  /** `?print=1`: open the print dialog once the card is ready. */
  autoPrint: boolean;
}

/** Reads the query the garden designer's Print button sends to a card. */
export function cardViewParams(search: URLSearchParams, kind: string): CardViewParams {
  const on = kind === 'area' ? ymdToUtcMs(search.get('on')) : null;
  return {
    ...(on != null ? { bedMapOnMs: on } : {}),
    autoPrint: search.get('print') === '1'
  };
}

/** The same card URL without `print`, so a reload or Back never reprints. */
export function withoutPrintParam(url: URL): URL {
  const next = new URL(url);
  next.searchParams.delete('print');
  return next;
}
