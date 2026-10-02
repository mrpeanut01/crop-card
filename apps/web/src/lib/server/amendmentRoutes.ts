/** Shared pieces of the /api/amendments/batches/** routes (33C). */

import { json } from '@sveltejs/kit';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { DEFAULT_PREFS, todayYmd } from '$lib/prefs';
import { farmTimeZone } from '$lib/db/userProfile';
import {
  needsSupplierAdvice,
  pathSentence,
  stateLabel,
  SUPPLIER_ADVICE,
  type CarryoverChain,
  type CarryoverState
} from '$lib/amendments/carryover';
import type { AmendmentBatch, AmendmentBatchInput } from '$lib/db/amendments';
import { lotLabel, subjectName, type LoadedChains } from './amendmentChain';

export function refusal(status: number, error: string, message: string): Response {
  return json({ error, message }, { status });
}

export interface FarmDay {
  y: number;
  m: number;
  d: number;
  ymd: string;
}

/** A real calendar day, or null. */
export function parseDay(ymd: string): FarmDay | null {
  const [y, m, d] = ymd.split('-').map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, ymd };
}

export interface DayContext {
  timeZone: string;
  today: string;
  startOf(day: FarmDay): number;
  /** Start of the day after (an exclusive end, M-35). */
  endOf(day: FarmDay): number;
}

export function dayContext(now: number = Date.now()): DayContext {
  const timeZone = farmTimeZone();
  return {
    timeZone,
    today: todayYmd({ ...DEFAULT_PREFS, timeZone }, now),
    startOf: (day) => zonedDayStartMs(day.y, day.m, day.d, timeZone),
    endOf: (day) => zonedDayStartMs(day.y, day.m, day.d + 1, timeZone)
  };
}

/** 400 for a bad or future day; the parsed day otherwise. */
export function checkDay(
  ctx: DayContext,
  ymd: string,
  field: string
): { day: FarmDay } | { response: Response } {
  const day = parseDay(ymd);
  if (!day) {
    return {
      response: json(
        { error: 'invalid request', issues: [{ path: field, message: 'Use a real date.' }] },
        { status: 400 }
      )
    };
  }
  if (ymd > ctx.today) {
    return { response: refusal(400, 'IN_THE_FUTURE', 'That date is in the future.') };
  }
  return { day };
}

export interface InputView extends AmendmentBatchInput {
  label: string;
}

export interface BatchView extends AmendmentBatch {
  state: CarryoverState;
  stateLabel: string;
  paths: Array<{ state: 'may-carry' | 'not-known'; inputId: string; sentence: string }>;
  morePaths: number;
  standingNotes: string[];
  advice: string | null;
  inputs: InputView[];
  provenance: 'data';
}

export function inputLabel(data: LoadedChains, i: AmendmentBatchInput): string {
  if (i.inputType === 'animal' || i.inputType === 'group') {
    return subjectName(data.names, i.inputType, i.inputId);
  }
  if (i.inputType === 'batch') return data.names.batches.get(i.inputId) ?? 'A batch';
  return lotLabel(data.names.lots.get(i.inputId));
}

const EMPTY: CarryoverChain = {
  batchId: '',
  state: 'none-on-file',
  paths: [],
  morePaths: 0,
  standingNotes: []
};

export function batchView(data: LoadedChains, batch: AmendmentBatch, timeZone: string): BatchView {
  const chain = data.chains.get(batch.id) ?? { ...EMPTY, batchId: batch.id };
  return {
    ...batch,
    state: chain.state,
    stateLabel: stateLabel(chain.state),
    paths: chain.paths.map((p) => ({
      state: p.state,
      inputId: p.inputId,
      sentence: pathSentence(p, timeZone)
    })),
    morePaths: chain.morePaths,
    standingNotes: chain.standingNotes,
    advice: needsSupplierAdvice(chain) ? SUPPLIER_ADVICE : null,
    inputs: data.inputs
      .filter((i) => i.batchId === batch.id)
      .map((i) => ({ ...i, label: inputLabel(data, i) })),
    provenance: 'data'
  };
}

export async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
}
