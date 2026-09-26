/**
 * Bed history, rotation warnings and companion hints for the designer.
 * Rotation wraps `buildRotationSuggestion` (lib/season/carryForwardPlan.ts);
 * companions read `goodWith`/`badWith`/`keepApart` from companion plugins
 * through `lib/plugins/companionRelations.ts`.
 */

import type { CompanionPlugin } from '$lib/plugins/schemas';
import { keepApartMatch } from '$lib/plugins/companionRelations';
import { buildRotationSuggestion, rotationLookbackDefault } from '$lib/season/carryForwardPlan';
import { intervalsOverlapInTime } from './occupancy';
import type {
  BedHistoryEntry,
  BedLayout,
  CompanionHint,
  OccupancyInterval,
  PlacedPlanting,
  RotationWarning
} from './types';

export const ROTATION_HISTORY_YEARS = 4;

const FAMILY_LABELS: Record<string, string> = {
  solanaceae: 'Tomato family',
  cucurbit: 'Squash family',
  brassica: 'Cabbage family',
  allium: 'Onion family',
  legume: 'Bean family',
  'leafy-green': 'Leafy greens',
  root: 'Root crops',
  apiaceae: 'Carrot family',
  corn: 'Corn',
  'herb-culinary': 'Herbs',
  'cereal-grain': 'Small grains',
  forage: 'Forage',
  'cover-grass': 'Grass cover crops',
  'cover-legume': 'Legume cover crops',
  'broadleaf-companion': 'Flowering companions'
};

/** Plain name for a crop family, e.g. "Tomato family" for solanaceae. */
export function familyLabel(family: string): string {
  const known = FAMILY_LABELS[family];
  if (known) return known;
  const words = family.replace(/[-_.]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'This family';
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Newest first, grouped by `seasonYear`, at most `ROTATION_HISTORY_YEARS`
 *  seasons before `seasonYear` plus the current one. */
export function bedHistory(
  history: readonly BedHistoryEntry[],
  seasonYear: number
): BedHistoryEntry[] {
  const oldest = seasonYear - ROTATION_HISTORY_YEARS;
  return history
    .filter((h) => h.seasonYear >= oldest && h.seasonYear <= seasonYear)
    .sort(
      (a, b) =>
        b.seasonYear - a.seasonYear ||
        (b.plantingDateMs ?? -Infinity) - (a.plantingDateMs ?? -Infinity) ||
        cmpStr(a.cropId, b.cropId)
    );
}

/** Warnings for planting `candidateFamily` in this bed in `seasonYear`, one
 *  per family that repeats inside its plant-back window. Earlier plantings in
 *  the same season count as the prior season (a second tomato after spring
 *  tomatoes still warns). */
export function rotationWarnings(
  blockId: string,
  blockName: string,
  history: readonly BedHistoryEntry[],
  candidateFamily: string,
  seasonYear: number,
  lookbackByFamily: Readonly<Record<string, number>>
): RotationWarning[] {
  const sameFamily = history.filter(
    (h) => h.cropFamily === candidateFamily && h.seasonYear <= seasonYear
  );
  const years = [...new Set(sameFamily.map((h) => h.seasonYear))].sort((a, b) => b - a);
  const lookback = lookbackByFamily[candidateFamily] ?? rotationLookbackDefault();
  for (const year of years) {
    const fromYear = Math.min(year, seasonYear - 1);
    const suggestion = buildRotationSuggestion(
      {
        blockId,
        blockName,
        priorPlantings: sameFamily
          .filter((h) => h.seasonYear === year)
          .map((h) => ({
            cropPluginId: h.cropPluginId,
            cropFamily: h.cropFamily,
            varietyDisplayName: h.varietyDisplayName,
            archetype: h.archetype,
            plantingDateMs: h.plantingDateMs,
            status: h.status
          }))
      },
      { ...lookbackByFamily },
      fromYear,
      seasonYear
    );
    if (suggestion.severity === 'ok' || !suggestion.avoidFamilies.includes(candidateFamily)) {
      continue;
    }
    const when = year === seasonYear ? 'earlier this season' : `in ${year}`;
    const span = lookback === 1 ? '1 year' : `${lookback} years`;
    return [
      {
        blockId,
        family: candidateFamily,
        severity: suggestion.severity,
        lastSeasonYear: year,
        lookbackYears: lookback,
        message: `${familyLabel(candidateFamily)} grew here ${when}. Rotating away for ${span} cuts disease carryover.`
      }
    ];
  }
  return [];
}

type Side = CompanionHint['a'];

function sideOf(p: PlacedPlanting): Side {
  return { blockId: p.blockId, cropId: p.cropId, cropPluginId: p.cropPluginId };
}

function familiesOf(c: CompanionPlugin): Set<string> {
  const out = new Set<string>();
  if (c.primaryFamily) out.add(c.primaryFamily);
  for (const m of c.members ?? []) out.add(m.family);
  return out;
}

function relationFor(
  c: CompanionPlugin,
  a: PlacedPlanting,
  b: PlacedPlanting
): { relation: CompanionHint['relation']; note: string | null } | null {
  const apart = keepApartMatch(c, a.cropPluginId, b.cropPluginId);
  if (apart) return { relation: 'keep-apart', note: apart.reason };
  const good = c.goodWith ?? [];
  const aGood = good.includes(a.cropPluginId);
  const bGood = good.includes(b.cropPluginId);
  const note = c.benefit ?? null;
  if (aGood && bGood) return { relation: 'good-neighbor', note };
  if (aGood || bGood) {
    const other = aGood ? b : a;
    if (familiesOf(c).has(other.cropFamily)) return { relation: 'good-neighbor', note };
  }
  return null;
}

/** Hints for plantings whose intervals overlap in time, in the same bed or in
 *  beds `adjacentBeds` pairs. Good: both crops in one plugin's `goodWith`, or
 *  one there and the other's family equal to its `primaryFamily` or a
 *  `members[].family`. Keep apart: both in one plugin's `badWith`, or one on
 *  each side of one of its `keepApart` entries (see `keepApartMatch`). One hint
 *  per companion plugin per crop pair; `keep-apart` sorts first. Two
 *  plantings of the same crop plugin never pair. */
export function companionHints(
  beds: readonly BedLayout[],
  plantings: readonly PlacedPlanting[],
  intervals: readonly OccupancyInterval[],
  companions: readonly CompanionPlugin[],
  adjacency: ReadonlyArray<readonly [string, string]>
): CompanionHint[] {
  const bedIds = new Set(beds.map((b) => b.blockId));
  const near = new Set(adjacency.map(([x, y]) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`)));
  const intervalOf = new Map(intervals.map((i) => [i.cropId, i]));
  const placed = plantings
    .filter((p) => bedIds.has(p.blockId) && intervalOf.has(p.cropId))
    .sort((p, q) => cmpStr(p.cropId, q.cropId));
  const out: CompanionHint[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.cropId === b.cropId || a.cropPluginId === b.cropPluginId) continue;
      const sameBed = a.blockId === b.blockId;
      const key =
        a.blockId < b.blockId ? `${a.blockId}\u0000${b.blockId}` : `${b.blockId}\u0000${a.blockId}`;
      if (!sameBed && !near.has(key)) continue;
      if (!intervalsOverlapInTime(intervalOf.get(a.cropId)!, intervalOf.get(b.cropId)!)) continue;
      for (const c of companions) {
        const found = relationFor(c, a, b);
        if (!found) continue;
        out.push({
          relation: found.relation,
          companionPluginId: c.pluginId,
          a: sideOf(a),
          b: sideOf(b),
          sameBed,
          benefit: found.note
        });
      }
    }
  }
  return out.sort(
    (x, y) =>
      (x.relation === y.relation ? 0 : x.relation === 'keep-apart' ? -1 : 1) ||
      Number(y.sameBed) - Number(x.sameBed) ||
      cmpStr(x.companionPluginId, y.companionPluginId) ||
      cmpStr(x.a.cropId, y.a.cropId) ||
      cmpStr(x.b.cropId, y.b.cropId)
  );
}
