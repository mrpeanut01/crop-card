import { error, redirect } from '@sveltejs/kit';
import { cardHref, parseCardKey, parseRecordCardKey, recordHref } from '$lib/cards/model';
import { CARD_RECORD_KINDS } from '$lib/db/recordKinds';
import { profitCardHref } from '$lib/cards/build/profit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const record = parseRecordCardKey(params.key);
  if (record) {
    if (!CARD_RECORD_KINDS.includes(record.recordKind)) {
      throw error(404, 'No such card');
    }
    throw redirect(302, recordHref(record.recordKind, record.rowId));
  }
  const parsed = parseCardKey(params.key);
  if (!parsed) throw error(404, 'No such card');
  if (parsed.kind === 'digest') throw redirect(302, '/today');
  if (parsed.kind === 'profit') throw redirect(302, profitCardHref(parsed.id));
  throw redirect(302, cardHref(parsed.kind, params.key));
};
