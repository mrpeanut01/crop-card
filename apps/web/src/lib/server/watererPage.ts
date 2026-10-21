/** What the equipment page needs to show and edit an automatic waterer
 *  (Phase 37E). Server-only; every read is tenant-scoped. */

import type { Equipment } from '$lib/db/equipment';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { farmTimeZone } from '$lib/db/userProfile';
import { listIrrigationSkips, listWaterTargetDetails } from '$lib/db/waterers';
import { WATERER_METHODS, type WatererMethod } from '$lib/irrigation/apiSchemas';
import { gallonsSplit, scheduleOf, type GallonsSplit } from '$lib/irrigation/schedule';
import { skipUndoVerdict } from '$lib/irrigation/skipUndo';
import { ymdInZone } from '$lib/prefs';
import { sqFtOf } from '$lib/server/waterAdvice.server';

/** Area kinds a waterer can water: the ones that get watering advice. */
const WATERED_KINDS = ['garden', 'field'] as const;

/** Skips shown on the page: the advice window back and the skip reach ahead. */
const SKIP_REACH_MS = 8 * 24 * 60 * 60 * 1000;

function methodOf(spec: Record<string, unknown> | undefined): WatererMethod {
  const m = spec?.method;
  return (WATERER_METHODS as readonly unknown[]).includes(m) ? (m as WatererMethod) : 'drip';
}

export interface WatererSkipView {
  id: string;
  scheduledAt: number;
  reason: 'did-not-run' | 'turned-off-for-rain' | 'other';
  canUndo: boolean;
}

export function watererPageData(
  equipment: Equipment,
  viewer: { id: string; role: string } | null,
  nowMs: number = Date.now()
) {
  const blocks = listBlocks({ plantings: 'none' });
  const details = listWaterTargetDetails(equipment.id);
  const split: GallonsSplit = gallonsSplit(
    details.map((t) => ({
      fieldId: t.fieldId,
      blockId: t.blockId,
      sharePct: t.sharePct,
      sqFt: t.blockSize ? sqFtOf(t.blockSize) : sqFtOf(t.fieldSize),
      blockFieldId: t.blockFieldId
    }))
  );
  const timeZone = farmTimeZone();
  const skips: WatererSkipView[] = listIrrigationSkips({
    equipmentIds: [equipment.id],
    fromMs: nowMs - SKIP_REACH_MS,
    toMs: nowMs + SKIP_REACH_MS
  }).map((s) => ({
    id: s.id,
    scheduledAt: s.scheduledAt,
    reason: s.reason,
    canUndo: viewer !== null && skipUndoVerdict(s, viewer, nowMs) === 'ok'
  }));
  return {
    schedule: scheduleOf(equipment.spec),
    defaultMethod: methodOf(equipment.spec),
    targets: details.map((t, i) => ({
      fieldId: t.fieldId,
      blockId: t.blockId,
      sharePct: t.sharePct,
      /** This target's share of the gallons as a whole percent, when known. */
      splitPct: split.known ? Math.round((split.fractions[i] ?? 0) * 100) : null
    })),
    split: split.known
      ? { known: true as const, source: split.source }
      : { known: false as const, reason: split.reason },
    skips,
    timeZone,
    todayYmd: ymdInZone(nowMs, timeZone),
    areas: listFields({ kinds: WATERED_KINDS })
      .map((f) => ({
        id: f.id,
        name: f.name,
        beds: blocks
          .filter((b) => b.fieldId === f.id)
          .map((b) => ({ id: b.id, name: b.blockLabel ?? b.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
