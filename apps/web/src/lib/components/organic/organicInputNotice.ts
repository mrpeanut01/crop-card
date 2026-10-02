/**
 * What the organic input notice says (33B, B-20). Pure and client-safe so
 * the four record pages and the tests share one wording. Never blocks or
 * delays a save; it names each product and each block.
 */

import type { OrganicInputClass } from '$lib/organic/inputCompliance';
import { t } from '$lib/i18n';

export interface NoticeProduct {
  name: string;
  inputClass: OrganicInputClass;
}

export interface OrganicNotice {
  products: { name: string; inputClass: 'not-allowed' | 'not-marked'; message: string }[];
  blocks: { id: string; name: string; statusLine: string }[];
}

function recordPhrase(blockCount: number, locale?: string | null): string {
  return blockCount === 1
    ? t(locale, 'organic.notice.recordOne')
    : t(locale, 'organic.notice.recordMany');
}

export function organicNoticeMessage(
  inputClass: 'not-allowed' | 'not-marked',
  blockCount: number,
  locale?: string | null
): string {
  const lead =
    inputClass === 'not-allowed'
      ? t(locale, 'organic.notice.notAllowed')
      : t(locale, 'organic.notice.notMarked');
  return `${lead} ${recordPhrase(blockCount, locale)}`;
}

/** Null when no selected block has an organic or transitioning status
 *  today, or every selected product is marked allowed. */
export function organicInputNotice(
  input: {
    organicBlocks: Record<string, string> | null | undefined;
    selectedBlockIds: readonly string[];
    products: readonly NoticeProduct[];
    blockNames?: Record<string, string>;
  },
  locale?: string | null
): OrganicNotice | null {
  const statuses = input.organicBlocks ?? {};
  const blockIds = [...new Set(input.selectedBlockIds)].filter((id) =>
    Object.prototype.hasOwnProperty.call(statuses, id)
  );
  if (blockIds.length === 0) return null;
  const seen = new Set<string>();
  const products: OrganicNotice['products'] = [];
  for (const p of input.products) {
    if (p.inputClass === 'allowed') continue;
    const key = `${p.inputClass}:${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      name: p.name,
      inputClass: p.inputClass,
      message: organicNoticeMessage(p.inputClass, blockIds.length, locale)
    });
  }
  if (products.length === 0) return null;
  return {
    products,
    blocks: blockIds.map((id) => ({
      id,
      name: input.blockNames?.[id] ?? t(locale, 'organic.notice.selectedBlock'),
      statusLine: statuses[id]
    }))
  };
}
