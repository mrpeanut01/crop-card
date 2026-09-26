import { ymdToUtcMs } from './build/common';

export interface CardViewParams {
  /** The day an Area Card's bed map shows (`?on=YYYY-MM-DD`). */
  bedMapOnMs?: number;
  /** `?print=1`: open the print dialog once the card is ready. */
  autoPrint: boolean;
  /** `?after=<ms>`: the designer's last saved change. A saved copy older
   *  than this may be missing it, so the print waits a little for a fresher
   *  one and then says which copy it printed. */
  afterMs?: number;
}

/** Reads the query the garden designer's Print button sends to a card. */
export function cardViewParams(search: URLSearchParams, kind: string): CardViewParams {
  const on = kind === 'area' ? ymdToUtcMs(search.get('on')) : null;
  const after = Number(search.get('after'));
  return {
    ...(on != null ? { bedMapOnMs: on } : {}),
    autoPrint: search.get('print') === '1',
    ...(Number.isSafeInteger(after) && after > 0 ? { afterMs: after } : {})
  };
}

/** The same card URL without `print`, so a reload or Back never reprints. */
export function withoutPrintParam(url: URL): URL {
  const next = new URL(url);
  next.searchParams.delete('print');
  next.searchParams.delete('after');
  return next;
}

/** Whether the saved copy predates the change the print was asked after. */
export function snapshotOlderThan(generatedAt: number, afterMs: number | undefined): boolean {
  return afterMs !== undefined && generatedAt < afterMs;
}
