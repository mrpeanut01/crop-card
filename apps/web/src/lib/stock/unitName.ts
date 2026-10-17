/** One spelling for a unit name typed or stored in different ways
 *  ("fl oz", "FLOZ", " pt "), shared by every unit conversion. Pure, with no
 *  imports, so the safety kernel can use it. */
export function normalizeUnitName(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\s+/g, '-');
  return u === 'floz' || u === 'fl.-oz' || u === 'fl.oz' ? 'fl-oz' : u;
}
