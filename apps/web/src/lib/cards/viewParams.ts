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
  /** Week and Month Cards: `?area=<fieldId>`. */
  area?: string;
  /** Week and Month Cards: `?who=<userId>|unassigned`. */
  who?: string;
}

const FILTER_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/;

function filterParam(search: URLSearchParams, name: string): string | undefined {
  const v = search.get(name);
  return v && FILTER_VALUE.test(v) ? v : undefined;
}

/** Reads the query the garden designer's Print button sends to a card. */
export function cardViewParams(search: URLSearchParams, kind: string): CardViewParams {
  const on = kind === 'area' ? ymdToUtcMs(search.get('on')) : null;
  const after = Number(search.get('after'));
  const calendar = kind === 'week' || kind === 'month';
  const area = calendar ? filterParam(search, 'area') : undefined;
  const who = calendar ? filterParam(search, 'who') : undefined;
  return {
    ...(on != null ? { bedMapOnMs: on } : {}),
    autoPrint: search.get('print') === '1',
    ...(Number.isSafeInteger(after) && after > 0 ? { afterMs: after } : {}),
    ...(area ? { area } : {}),
    ...(who ? { who } : {})
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
