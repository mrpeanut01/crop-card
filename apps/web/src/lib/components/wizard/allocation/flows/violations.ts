import type { BlockEntry, SeedStockEntry } from '../types';

/** Translate a raw validator violation string into operator-friendly
 *  text. Replaces UUIDs with block/variety names from props and
 *  rewrites the known "family density" pattern into plain English.
 *  Anything we don't recognize falls through to UUID-replacement only —
 *  the operator still gets readable names even when the rule wording
 *  stays technical. */
export function humanizeAllocationViolation(
  v: string,
  blocks: ReadonlyArray<BlockEntry>,
  seedStock: ReadonlyArray<SeedStockEntry>
): string {
  const blockNames = new Map<string, string>();
  for (const b of blocks) blockNames.set(b.id, b.name);
  const seedNames = new Map<string, string>();
  for (const s of seedStock) {
    seedNames.set(s.stockItemId, s.shortName ?? s.displayName);
  }
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const replaceIds = (str: string) =>
    str.replace(UUID_RE, (id) => {
      const b = blockNames.get(id);
      if (b) return `“${b}”`;
      const s = seedNames.get(id);
      if (s) return `“${s}”`;
      return id;
    });

  // Family-density pattern: "block <id> packs multiple <family>
  // varieties: total N plants exceeds 1.25× the largest plantsFit (M)"
  const familyMatch = v.match(
    /^block ([0-9a-f-]{36}) packs multiple (\S+) varieties: total (\d+) plants exceeds 1\.25× the largest plantsFit \((\d+)\)/i
  );
  if (familyMatch) {
    const [, blockId, family, totalStr, capStr] = familyMatch;
    const blockName = blockNames.get(blockId) ?? blockId;
    const total = Number(totalStr);
    const cap = Number(capStr);
    const overBy = total - cap;
    const detail = replaceIds(v).replace(/^.*\(/, '(');
    return (
      `Too many ${family} varieties packed onto “${blockName}”: ${total} plants total, ` +
      `but the block's largest single-variety capacity is ${cap}. That's ${overBy} plants ` +
      `over the recommended density. Spread some varieties to another block, or reduce ` +
      `plant counts. ${detail}`
    );
  }

  // Per-assignment density pattern: "assignment X→Y packs N/M plants
  // (R× capacity). Reduce or split..."
  const perAssign = v.match(
    /^assignment ([0-9a-f-]{36})→([0-9a-f-]{36}) packs (\d+)\/(\d+) plants \(([0-9.]+)× capacity\)/
  );
  if (perAssign) {
    const [, sid, bid, plantsStr, capStr] = perAssign;
    const seedName = seedNames.get(sid) ?? sid;
    const blockName = blockNames.get(bid) ?? bid;
    return (
      `“${seedName}” is over-packed on “${blockName}” (${plantsStr} plants vs. ` +
      `${capStr} recommended). This variety has other viable blocks — splitting or ` +
      `reducing would clear the density check.`
    );
  }

  // plantsFit cap pattern: "assignment[N] plants=X exceeds plantsFit=Y for (sid, bid)"
  const plantsFit = v.match(
    /plants=(\d+) exceeds plantsFit=(\d+) for \(([0-9a-f-]{36}), ([0-9a-f-]{36})\)/
  );
  if (plantsFit) {
    const [, plantsStr, capStr, sid, bid] = plantsFit;
    const seedName = seedNames.get(sid) ?? sid;
    const blockName = blockNames.get(bid) ?? bid;
    return `“${seedName}” on “${blockName}” has ${plantsStr} plants but the block only fits ${capStr}.`;
  }

  // Matrix-not-candidate pattern.
  const notCand = v.match(
    /assignment\[\d+\] \(([0-9a-f-]{36}) → ([0-9a-f-]{36})\) is not in the candidacy matrix/
  );
  if (notCand) {
    const [, sid, bid] = notCand;
    const seedName = seedNames.get(sid) ?? sid;
    const blockName = blockNames.get(bid) ?? bid;
    return `The AI proposed planting “${seedName}” on “${blockName}”, but this combination wasn't on the candidacy list (likely a sun, rotation, or capacity mismatch from the original blocks step).`;
  }

  // Default: UUID-replacement only.
  return replaceIds(v);
}
