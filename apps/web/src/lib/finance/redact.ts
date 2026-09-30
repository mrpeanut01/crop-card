/** F2-1, F2-2: money is owner only. A lot's cost is dropped from every lot
 *  payload served to anyone else. */

export function canSeeMoney(role: string | null | undefined): boolean {
  return role === 'owner';
}

export function lotsForRole<T extends { receivedCostCents?: number | null }>(
  lots: T[],
  role: string | null | undefined
): T[] {
  if (canSeeMoney(role)) return lots;
  return lots.map((lot) => {
    const { receivedCostCents: _cost, ...rest } = lot;
    void _cost;
    return rest as T;
  });
}
