/** Cost, in cents per whole unit, for a lot. `receivedCostCents` is the
 *  total cost of the received quantity. Null when the lot has no cost or
 *  nothing was received: that cost is unknown, never zero (F2-8). */
export function lotCostCentsPerUnit(
  receivedCostCents: number | null,
  receivedQuantityHundredths: number
): number | null {
  if (receivedCostCents === null || receivedQuantityHundredths <= 0) return null;
  const units = receivedQuantityHundredths / 100;
  return receivedCostCents / units;
}
