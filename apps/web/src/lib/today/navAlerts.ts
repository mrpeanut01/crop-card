import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';
import type { WinterizeAlert } from './winterizeAlert';

export interface NavAlert {
  id: string;
  tone: 'rust' | 'wheat';
  label: string;
  href: string;
}

export interface NavAlertInput {
  dirtySprayers: Array<{ id: string; label: string; lastChemistryClass?: string | null }>;
  winterize: WinterizeAlert[];
  lowStock: Array<{ id: string; displayName: string; category: string }>;
  expiring: Array<{ itemId: string; itemName: string; category: string; daysUntilExpiry: number }>;
}

function inventoryHref(category: string, id: string): string {
  const type = STOCK_CATEGORY_TO_INVENTORY_TYPE[category] ?? 'pesticide';
  return `/inventory/${type}/${encodeURIComponent(id)}`;
}

/** The same alerts /today renders, flattened for the top-bar bell. Decon first (it blocks the next spray). */
export function buildNavAlerts(input: NavAlertInput): NavAlert[] {
  const out: NavAlert[] = [];
  for (const s of input.dirtySprayers) {
    out.push({
      id: `decon:${s.id}`,
      tone: 'rust',
      label: `${s.label} needs decon${s.lastChemistryClass ? ` (${s.lastChemistryClass})` : ''}`,
      href: `/spray/decon?sprayer=${encodeURIComponent(s.id)}`
    });
  }
  for (const w of input.winterize) {
    out.push({
      id: `winterize:${w.sprayerId}`,
      tone: 'wheat',
      label: `${w.label}: ${w.uncalibrated ? 'recalibrate and ' : ''}check winterization`,
      href: `/equipment/${encodeURIComponent(w.sprayerId)}/winterize`
    });
  }
  for (const i of input.lowStock) {
    out.push({
      id: `low:${i.id}`,
      tone: 'wheat',
      label: `${i.displayName} is low on stock`,
      href: inventoryHref(i.category, i.id)
    });
  }
  const seenExpiring = new Set<string>();
  for (const e of input.expiring) {
    if (seenExpiring.has(e.itemId)) continue;
    seenExpiring.add(e.itemId);
    out.push({
      id: `expiring:${e.itemId}`,
      tone: 'wheat',
      label: `${e.itemName} lot expires in ${e.daysUntilExpiry} day${e.daysUntilExpiry === 1 ? '' : 's'}`,
      href: inventoryHref(e.category, e.itemId)
    });
  }
  return out;
}
