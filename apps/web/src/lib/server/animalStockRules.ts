import { json } from '@sveltejs/kit';
import type { StockCategory } from '$lib/db/stock';
import { getDataKinds } from '$lib/server/registry';
import { MEDICATED_FEED_MESSAGE, feedMeta, isFeedCategory } from '$lib/stock/animalStock';

export interface AnimalStockWrite {
  category: StockCategory;
  defaultUnit: string;
  pluginId?: string | null;
  metadataJson?: string | null;
}

/** Server rules for feed, bedding and animal-health stock (Phase 32D).
 *  Medicated feed is refused under feed (D0-14), a bag needs its pounds
 *  (D0-13), feed never links to a library product, and a medicine can only
 *  link to a registered animal-health product. Routes call it after
 *  `requireOwner`, so a helper can never confirm a link (D0-15). */
export async function checkAnimalStockWrite(w: AnimalStockWrite): Promise<Response | null> {
  if (isFeedCategory(w.category)) {
    const meta = feedMeta(w.metadataJson);
    if (meta.medicated) {
      return json({ error: MEDICATED_FEED_MESSAGE, code: 'MEDICATED_FEED' }, { status: 422 });
    }
    if (w.defaultUnit === 'bag' && !meta.lbPerBag) {
      return json(
        { error: 'Say how many pounds are in one bag.', code: 'NEEDS_LB_PER_BAG' },
        { status: 400 }
      );
    }
    if (w.pluginId) {
      return json(
        { error: 'Feed and bedding do not link to a library product.', code: 'NO_FEED_PRODUCT' },
        { status: 400 }
      );
    }
  }
  if (w.category === 'animal-health' && w.pluginId) {
    if (!(await getDataKinds()).animalHealth.has(w.pluginId)) {
      return json(
        { error: 'That product is not in the animal-health library.', code: 'UNKNOWN_PRODUCT' },
        { status: 400 }
      );
    }
  }
  return null;
}
