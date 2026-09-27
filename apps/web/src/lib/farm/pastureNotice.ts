/**
 * The advisory pasture notice on the spray context strip (Phase 32C): who
 * lives on the Areas being sprayed and how long the chosen products keep
 * them off. Pure and client-safe. It never blocks the spray; the grazing
 * gate runs when animals are moved back.
 */

import type { GrazingRestrictions } from '$lib/plugins/schemas';
import { labelGrazeDays } from '$lib/safety/grazingInterval';

export interface AnimalsHereRow {
  label: string;
  speciesId: string;
  foodProducing: boolean;
  lactating: boolean;
}

export interface AnimalsHere {
  areaName: string;
  rows: AnimalsHereRow[];
}

export interface SprayPastureContext {
  animalsByArea: Record<string, AnimalsHere>;
  /** blockId → Area id, for the blocks on the page. */
  blockArea: Record<string, string>;
  /** Label data for products that carry it; anything missing is unknown. */
  restrictionsByPlugin: Record<string, GrazingRestrictions>;
}

export interface NoticeProduct {
  pluginId: string;
  name: string;
}

function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

function productLine(
  p: NoticeProduct,
  r: GrazingRestrictions | undefined,
  rows: AnimalsHereRow[]
): string {
  if (!r) {
    return `The grazing interval for ${p.name} is not on file. Food animals have to stay off after this spray until the owner adds it from the label.`;
  }
  if (r.notForPasture === true) return `The ${p.name} label forbids use where animals graze.`;
  let longest = 0;
  for (const row of rows) {
    const d = labelGrazeDays(r, { speciesId: row.speciesId, lactating: row.lactating });
    if (d === 'unknown') {
      return `Part of the grazing interval for ${p.name} is not on file. Food animals have to stay off after this spray until the owner adds it from the label.`;
    }
    longest = Math.max(longest, d);
  }
  return longest > 0
    ? `${p.name} requires removal for ${days(longest)}.`
    : `The ${p.name} label gives no grazing interval.`;
}

/** Lines for the notice, or null when no animals live on the selected blocks' Areas. */
export function pastureNotice(input: {
  blockIds: readonly string[];
  products: readonly NoticeProduct[];
  context: SprayPastureContext | null | undefined;
}): string[] | null {
  const ctx = input.context;
  if (!ctx) return null;
  const areaIds = [...new Set(input.blockIds.map((id) => ctx.blockArea[id]).filter(Boolean))];
  const here = areaIds.map((id) => ctx.animalsByArea[id]).filter((a): a is AnimalsHere => !!a);
  if (here.length === 0) return null;
  const lines = here.map(
    (a) => `Animals here now in ${a.areaName}: ${a.rows.map((r) => r.label).join(', ')}.`
  );
  const rows = here.flatMap((a) => a.rows);
  if (input.products.length === 0) {
    lines.push('Check the label for a grazing interval before you spray.');
  }
  for (const p of input.products) {
    lines.push(productLine(p, ctx.restrictionsByPlugin[p.pluginId], rows));
  }
  lines.push('Move them off before you spray.');
  return lines;
}
