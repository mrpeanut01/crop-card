import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlock } from '$lib/db/blocks';
import { getCutting } from '$lib/db/hayCuttings';
import {
  forageFactsForArea,
  listForageTests,
  stockLotCategory,
  type ForageTestFilter
} from '$lib/db/forageTests';
import { farmTimeZone } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { forageAccess } from '$lib/forage/access';
import { testView } from '$lib/forage/advisory';
import type { ForageTestTarget } from '$lib/forage/form';
import { t } from '$lib/i18n';

/** Forage lab results for an Area, block, hay cutting or feed lot (Phase
 *  33C, M-61). Every role reads; owner, helper and custom operator record. */
export const load: PageServerLoad = async (event) => {
  const q = event.url.searchParams;
  const fieldId = q.get('fieldId');
  const blockId = q.get('blockId');
  const hayCuttingId = q.get('hayCuttingId');
  const stockLotId = q.get('stockLotId');
  const locale = event.locals?.locale;

  let title: string;
  let target: ForageTestTarget | null = null;
  let blocks: Array<{ id: string; name: string }> = [];
  let filter: ForageTestFilter;
  let backHref = '/plan';
  if (fieldId) {
    const facts = forageFactsForArea(fieldId);
    if (!facts.area) error(404, t(locale, 'forage.page.areaNotFound'));
    title = facts.area.name;
    blocks = facts.blocks.map((b) => ({ id: b.id, name: b.name }));
    filter = { blockIds: blocks.map((b) => b.id), hayCuttingIds: facts.cuts.map((c) => c.id) };
    backHref = `/plan?area=${encodeURIComponent(fieldId)}`;
  } else if (blockId) {
    const block = getBlock(blockId);
    if (!block) error(404, t(locale, 'forage.page.blockNotFound'));
    title = block.name;
    target = { blockId };
    filter = { blockId };
    backHref = `/plan?block=${encodeURIComponent(blockId)}`;
  } else if (hayCuttingId) {
    const cutting = getCutting(hayCuttingId);
    if (!cutting) error(404, t(locale, 'forage.page.cuttingNotFound'));
    const block = getBlock(cutting.blockId);
    title = block
      ? t(locale, 'forage.page.hayCuttingFrom', { n: cutting.cuttingNumber, block: block.name })
      : t(locale, 'forage.page.hayCutting', { n: cutting.cuttingNumber });
    target = { hayCuttingId };
    filter = { hayCuttingId };
    backHref = `/hay?block=${encodeURIComponent(cutting.blockId)}&year=${cutting.year}`;
  } else if (stockLotId) {
    if (stockLotCategory(stockLotId) !== 'feed') error(404, t(locale, 'forage.page.lotNotFound'));
    title = t(locale, 'forage.page.feedLot');
    target = { stockLotId };
    filter = { stockLotId };
    backHref = '/inventory';
  } else {
    error(400, t(locale, 'forage.page.nameOne'));
  }

  const timeZone = farmTimeZone();
  const blockNames = new Map(blocks.map((b) => [b.id, b.name]));
  const tests = listForageTests(filter).map((row) => ({
    ...testView(row, timeZone, locale),
    lab: row.lab,
    where: row.blockId
      ? (blockNames.get(row.blockId) ?? null)
      : row.hayCuttingId
        ? t(locale, 'forage.page.whereHay')
        : null,
    hasReport: !!row.documentId
  }));
  return {
    title,
    target,
    blocks,
    tests,
    backHref,
    access: forageAccess(currentUser(event)?.role)
  };
};
