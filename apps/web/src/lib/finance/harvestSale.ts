/** "Record a sale" after a harvest (F2-15). Client-safe. */

/** "40 lb" → { quantity: 40, unit: 'lb' }. Null when the harvest quantity
 *  does not start with a number. */
export function parseHarvestQuantity(
  raw: string | null | undefined
): { quantity: number; unit: string | null } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z .]{0,29})?/.exec(raw ?? '');
  if (!m) return null;
  const quantity = Number(m[1]);
  if (!(quantity > 0)) return null;
  const unit = m[2]?.trim().replace(/\.$/, '') || null;
  return { quantity, unit };
}

export interface SaleLink {
  harvestEventId: string;
  cropId: string;
  /** "Also record the money" from a disposition (B-31): the sale links back. */
  dispositionId?: string;
}

export function recordSaleHref(link: SaleLink): string {
  const q = new URLSearchParams({
    kind: 'income',
    harvestEventId: link.harvestEventId,
    cropId: link.cropId
  });
  if (link.dispositionId) q.set('dispositionId', link.dispositionId);
  return `/finance/new?${q.toString()}`;
}

export const RECORD_SALE_OFFLINE = 'Record the sale on Money when you have signal';
