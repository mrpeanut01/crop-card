import { isHealthStock, type HealthStockOption } from '$lib/animals/healthStock';
import { listLotsForItem, listStockItems } from '$lib/db/stock';
import { getDataKinds } from './registry';

function singleLotNumber(stockItemId: string, now: number): string | null {
  const onHand = listLotsForItem(stockItemId).filter(
    (l) =>
      l.quantityStatus === 'existing' && l.balance > 0 && (l.expiresAt == null || l.expiresAt > now)
  );
  return onHand.length === 1 ? onHand[0].lotNumber?.trim() || null : null;
}

/** The "Taken from stock" choices on a health record (#649). */
export async function healthStockOptions(): Promise<HealthStockOption[]> {
  const library = (await getDataKinds()).animalHealth;
  const now = Date.now();
  return listStockItems()
    .filter((s) => isHealthStock(s, (id) => library.has(id)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((s) => ({
      id: s.id,
      name: s.displayName,
      unit: s.defaultUnit,
      lotNumber: singleLotNumber(s.id, now)
    }));
}
