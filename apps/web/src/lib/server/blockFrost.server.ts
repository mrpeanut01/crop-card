/**
 * Per-block effective frost (Phase 32E, season extension). Reads the farm's
 * saved frost dates, the covers on the blocks and each block's Area in two
 * queries (covers; blocks joined to Areas), then applies the pure rules in
 * `lib/climate/effectiveFrost.ts`.
 */

import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { blocks, fields } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { getSetting } from '$lib/db/settings';
import { listBlockProtections, type BlockProtectionRow } from '$lib/db/blockProtections';
import { parseAreaDetails } from '$lib/farm/areaKinds';
import { isActiveAt, isHeated } from '$lib/climate/protection';
import type { BedFrostView } from '$lib/climate/protectionView';
import {
  effectiveFrostSummary,
  effectiveFrostDates,
  type EffectiveFrost,
  type SeasonFrostMs
} from '$lib/climate/effectiveFrost';
import { frostDatesForYear } from '$lib/schedule/settings';
import { SETTINGS_KEYS, parseMmDd } from '$lib/schedule/constants';

export { listBlockProtections as loadBlockProtections };

export interface BlockAreaKind {
  blockId: string;
  areaKind: string | null;
  heated: boolean;
}

/** Area kind and greenhouse heat for each block, one query. */
export function loadBlockAreas(blockIds: readonly string[]): Map<string, BlockAreaKind> {
  const out = new Map<string, BlockAreaKind>();
  if (blockIds.length === 0) return out;
  const rows = db
    .select({
      blockId: blocks.id,
      areaKind: fields.kind,
      detailsJson: fields.detailsJson
    })
    .from(blocks)
    .leftJoin(fields, eq(fields.id, blocks.fieldId))
    .where(withTenant(blocks, inArray(blocks.id, [...new Set(blockIds)])))
    .all();
  for (const r of rows) {
    const details =
      r.areaKind === 'greenhouse' ? parseAreaDetails('greenhouse', r.detailsJson) : null;
    out.set(r.blockId, {
      blockId: r.blockId,
      areaKind: r.areaKind ?? null,
      heated: !!(details && 'heated' in details && details.heated === true)
    });
  }
  return out;
}

/** Saved hard-frost dates for season `year`, placed in the calendar year of
 *  the matching light-frost date. Missing dates stay missing. */
export function hardFrostForYear(
  year: number,
  farm: SeasonFrostMs = frostDatesForYear(year)
): Partial<SeasonFrostMs> {
  const out: Partial<SeasonFrostMs> = {};
  const last = parseMmDd(getSetting(SETTINGS_KEYS.lastHardFrost) ?? undefined);
  const first = parseMmDd(getSetting(SETTINGS_KEYS.firstHardFrost) ?? undefined);
  if (last) {
    out.lastSpringFrostMs = new Date(
      new Date(farm.lastSpringFrostMs).getFullYear(),
      last.month,
      last.day
    ).getTime();
  }
  if (first) {
    out.firstFallFrostMs = new Date(
      new Date(farm.firstFallFrostMs).getFullYear(),
      first.month,
      first.day
    ).getTime();
  }
  return out;
}

export interface EffectiveFrostContext {
  farm: SeasonFrostMs;
  hardFrost: Partial<SeasonFrostMs>;
}

export function effectiveFrostContext(seasonYear: number): EffectiveFrostContext {
  const farm = frostDatesForYear(seasonYear);
  return { farm, hardFrost: hardFrostForYear(seasonYear, farm) };
}

/** Pure part of the loader, shared with tests. */
export function effectiveFrostByBlock(
  blockIds: readonly string[],
  seasonYear: number,
  ctx: EffectiveFrostContext,
  covers: readonly BlockProtectionRow[],
  areas: ReadonlyMap<string, BlockAreaKind>
): Record<string, EffectiveFrost> {
  const byBlock = new Map<string, BlockProtectionRow[]>();
  for (const c of covers) {
    const list = byBlock.get(c.blockId) ?? [];
    list.push(c);
    byBlock.set(c.blockId, list);
  }
  const out: Record<string, EffectiveFrost> = {};
  for (const id of new Set(blockIds)) {
    const area = areas.get(id);
    out[id] = effectiveFrostDates(ctx.farm, {
      seasonYear,
      protections: byBlock.get(id) ?? [],
      heatedArea: area?.areaKind === 'greenhouse' && area.heated,
      unheatedGreenhouseArea: area?.areaKind === 'greenhouse' && !area.heated,
      hardFrost: ctx.hardFrost
    });
  }
  return out;
}

export function loadEffectiveFrostByBlock(
  blockIds: readonly string[],
  seasonYear: number,
  ctx: EffectiveFrostContext = effectiveFrostContext(seasonYear)
): Record<string, EffectiveFrost> {
  if (blockIds.length === 0) return {};
  return effectiveFrostByBlock(
    blockIds,
    seasonYear,
    ctx,
    listBlockProtections(blockIds),
    loadBlockAreas(blockIds)
  );
}

/** Only the blocks whose frost differs from the farm's, in the shape
 *  `scheduleCandidacy` takes. */
export function frostByBlockForPlanner(
  eff: Record<string, EffectiveFrost>,
  farm: SeasonFrostMs
): Record<string, SeasonFrostMs & { frostFree?: boolean }> {
  const out: Record<string, SeasonFrostMs & { frostFree?: boolean }> = {};
  for (const [id, e] of Object.entries(eff)) {
    if (
      e.frostFree ||
      e.lastSpringFrostMs !== farm.lastSpringFrostMs ||
      e.firstFallFrostMs !== farm.firstFallFrostMs
    ) {
      out[id] = {
        lastSpringFrostMs: e.lastSpringFrostMs,
        firstFallFrostMs: e.firstFallFrostMs,
        ...(e.frostFree ? { frostFree: true } : {})
      };
    }
  }
  return out;
}

export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A bed's effective frost as local days, for `plantingWindow` callers. */
export function bedFrostView(
  e: EffectiveFrost,
  farm: SeasonFrostMs,
  year: number,
  locale?: string | null
): BedFrostView {
  return {
    lastSpring: e.frostFree ? `${year}-01-01` : localDay(e.lastSpringFrostMs),
    firstFall: e.frostFree ? `${year}-12-31` : localDay(e.firstFallFrostMs),
    frostFree: e.frostFree,
    farmLastSpring: localDay(farm.lastSpringFrostMs),
    farmFirstFall: localDay(farm.firstFallFrostMs),
    summary: effectiveFrostSummary(e, locale)
  };
}

/** One bed's effective frost as local-midnight ms, the shape
 *  `frostDatesForYear` returns; the farm's dates when nothing moves them. */
export function bedFrostMs(
  blockId: string,
  seasonYear: number
): SeasonFrostMs & { frostFree: boolean } {
  const e = loadEffectiveFrostByBlock([blockId], seasonYear)[blockId];
  return {
    lastSpringFrostMs: e.lastSpringFrostMs,
    firstFallFrostMs: e.firstFallFrostMs,
    frostFree: e.frostFree
  };
}

/** One bed's effective frost as local days, plus the cover line for prompts. */
export function bedFrostIso(
  blockId: string,
  seasonYear: number
): { lastSpring: string; firstFall: string; frostFree: boolean; coverNote: string | null } {
  const e = loadEffectiveFrostByBlock([blockId], seasonYear)[blockId];
  return {
    lastSpring: e.frostFree ? `${seasonYear}-01-01` : localDay(e.lastSpringFrostMs),
    firstFall: e.frostFree ? `${seasonYear}-12-31` : localDay(e.firstFallFrostMs),
    frostFree: e.frostFree,
    coverNote: effectiveFrostSummary(e)
  };
}

/** `frostByBlock` for `scheduleCandidacy`: only blocks whose covers move
 *  their frost. Empty (and so byte-identical planning) with no covers. */
export function plannerFrostByBlock(
  blockIds: Iterable<string>,
  seasonYear: number
): Record<string, SeasonFrostMs & { frostFree?: boolean }> {
  const ids = [...new Set(blockIds)];
  if (ids.length === 0) return {};
  const ctx = effectiveFrostContext(seasonYear);
  return frostByBlockForPlanner(loadEffectiveFrostByBlock(ids, seasonYear, ctx), ctx.farm);
}

/** Cover state per block at an instant (E2-12): `heated` for an active
 *  heated cover or a heated greenhouse Area, `covered` for any other active
 *  cover or an unheated greenhouse Area. Two queries. */
export function activeCoverByBlock(
  blockIds: readonly string[],
  nowMs: number
): Map<string, 'heated' | 'covered'> {
  const out = new Map<string, 'heated' | 'covered'>();
  const ids = [...new Set(blockIds)];
  if (ids.length === 0) return out;
  const areas = loadBlockAreas(ids);
  for (const [id, a] of areas) {
    if (a.areaKind === 'greenhouse') out.set(id, a.heated ? 'heated' : 'covered');
  }
  for (const p of listBlockProtections(ids)) {
    if (!isActiveAt(p, nowMs)) continue;
    if (isHeated(p.kind)) out.set(p.blockId, 'heated');
    else if (!out.has(p.blockId)) out.set(p.blockId, 'covered');
  }
  return out;
}
