import { error, redirect } from '@sveltejs/kit';
import { cardHref, parseCardKey, parseRecordCardKey, recordHref } from '$lib/cards/model';
import { RECORD_KINDS } from '$lib/db/recordKinds';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const record = parseRecordCardKey(params.key);
  if (record) {
    if (!(RECORD_KINDS as readonly string[]).includes(record.recordKind)) {
      throw error(404, 'No such card');
    }
    throw redirect(302, recordHref(record.recordKind, record.rowId));
  }
  const parsed = parseCardKey(params.key);
  if (!parsed) throw error(404, 'No such card');
  throw redirect(302, cardHref(parsed.kind, params.key));
};
