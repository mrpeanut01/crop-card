import type { BlockEntry, SeedStockEntry } from '../types';
import { wt } from '../wt';

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

  // Phase 35 (C-1): stable prefixes from the shared validator. The rest of
  // the string is diagnostic; pull the seed and block ids out of it.
  if (v.startsWith('unplaced-with-room:') || v.startsWith('kept-in-one-bed:')) {
    const tokens = v.match(/[A-Za-z0-9_-]{6,}/g) ?? [];
    const sid = tokens.find((tok) => seedNames.has(tok));
    const bid = tokens.find((tok) => blockNames.has(tok));
    const seed = sid ? seedNames.get(sid)! : '';
    if (v.startsWith('kept-in-one-bed:')) {
      return wt('wizard.viol.keptInOneBed', { seed: seed || replaceIds(v) });
    }
    if (seed && bid) {
      return wt('wizard.viol.unplacedWithRoom', { seed, block: blockNames.get(bid)! });
    }
    return replaceIds(v);
  }

  if (v.startsWith('keep-apart:') || v.startsWith('split-ruled-out:')) {
    const tokens = v.match(/[A-Za-z0-9_-]{3,}/g) ?? [];
    const sid = tokens.find((tok) => seedNames.has(tok));
    const bid = tokens.find((tok) => blockNames.has(tok));
    const seed = sid ? seedNames.get(sid)! : '';
    if (!seed) return replaceIds(v);
    if (v.startsWith('split-ruled-out:')) return wt('wizard.viol.splitRuledOut', { seed });
    if (bid) return wt('wizard.viol.keepApart', { seed, block: blockNames.get(bid)! });
    return replaceIds(v);
  }

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
    return wt('wizard.viol.family', {
      family,
      block: blockName,
      total,
      cap,
      over: overBy,
      detail
    });
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
    return wt('wizard.viol.overpacked', {
      seed: seedName,
      block: blockName,
      plants: plantsStr,
      cap: capStr
    });
  }

  // plantsFit cap pattern: "assignment[N] plants=X exceeds plantsFit=Y for (sid, bid)"
  const plantsFit = v.match(
    /plants=(\d+) exceeds plantsFit=(\d+) for \(([0-9a-f-]{36}), ([0-9a-f-]{36})\)/
  );
  if (plantsFit) {
    const [, plantsStr, capStr, sid, bid] = plantsFit;
    const seedName = seedNames.get(sid) ?? sid;
    const blockName = blockNames.get(bid) ?? bid;
    return wt('wizard.viol.plantsFit', {
      seed: seedName,
      block: blockName,
      plants: plantsStr,
      cap: capStr
    });
  }

  // Matrix-not-candidate pattern.
  const notCand = v.match(
    /assignment\[\d+\] \(([0-9a-f-]{36}) → ([0-9a-f-]{36})\) is not in the candidacy matrix/
  );
  if (notCand) {
    const [, sid, bid] = notCand;
    const seedName = seedNames.get(sid) ?? sid;
    const blockName = blockNames.get(bid) ?? bid;
    return wt('wizard.viol.notCandidate', { seed: seedName, block: blockName });
  }

  // Default: UUID-replacement only.
  return replaceIds(v);
}
