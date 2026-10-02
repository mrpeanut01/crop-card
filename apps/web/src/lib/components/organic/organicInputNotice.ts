/**
 * What the organic input notice says (33B, B-20). Pure and client-safe so
 * the four record pages and the tests share one wording. Never blocks or
 * delays a save; it names each product and each block.
 */

import type { OrganicInputClass } from '$lib/organic/inputCompliance';

export interface NoticeProduct {
  name: string;
  inputClass: OrganicInputClass;
}

export interface OrganicNotice {
  products: { name: string; inputClass: 'not-allowed' | 'not-marked'; message: string }[];
  blocks: { id: string; name: string; statusLine: string }[];
}

function recordPhrase(blockCount: number): string {
  return blockCount === 1
    ? "It will show on this block's organic record."
    : "It will show on these blocks' organic records.";
}

export function organicNoticeMessage(
  inputClass: 'not-allowed' | 'not-marked',
  blockCount: number
): string {
  const lead =
    inputClass === 'not-allowed'
      ? 'The library marks this product as not allowed for organic use.'
      : "This product isn't marked as allowed for organic use.";
  return `${lead} ${recordPhrase(blockCount)}`;
}

/** Null when no selected block has an organic or transitioning status
 *  today, or every selected product is marked allowed. */
export function organicInputNotice(input: {
  organicBlocks: Record<string, string> | null | undefined;
  selectedBlockIds: readonly string[];
  products: readonly NoticeProduct[];
  blockNames?: Record<string, string>;
}): OrganicNotice | null {
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
      message: organicNoticeMessage(p.inputClass, blockIds.length)
    });
  }
  if (products.length === 0) return null;
  return {
    products,
    blocks: blockIds.map((id) => ({
      id,
      name: input.blockNames?.[id] ?? 'Selected block',
      statusLine: statuses[id]
    }))
  };
}
