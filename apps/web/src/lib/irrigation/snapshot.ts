/** The automatic waterers in the offline card snapshot (Phase 37E), and the
 *  Area Card line built from them. Client-safe. */

import type { CardModel } from '$lib/cards/model';
import { t } from '$lib/i18n';
import type { IrrigationSchedule } from './apiSchemas';
import { watererLine } from './summary';

export interface SnapshotWaterer {
  equipmentId: string;
  label: string;
  schedule: Pick<IrrigationSchedule, 'days' | 'start' | 'minutes' | 'method'> & {
    inchesPerRun: number | null;
  };
  targets: Array<{ fieldId: string; blockId: string | null }>;
}

/** "Drip timer: Mon, Wed, Fri 6:00 for 20 min" for each waterer on the Area. */
export function watererLinesFor(
  waterers: readonly SnapshotWaterer[] | undefined,
  areaId: string,
  locale?: string | null
): string[] {
  return (waterers ?? [])
    .filter((w) => w.targets.some((tg) => tg.fieldId === areaId))
    .map((w) => watererLine(w.label, w.schedule, locale));
}

/** The Area Card with a Timers fact when a waterer covers the Area. */
export function withSnapshotWaterers(
  card: CardModel,
  waterers: readonly SnapshotWaterer[] | undefined,
  areaId: string,
  locale?: string | null
): CardModel {
  const lines = watererLinesFor(waterers, areaId, locale);
  if (lines.length === 0) return card;
  return {
    ...card,
    facts: [
      ...card.facts,
      {
        label: t(locale, 'herbse.schedule.factLabel'),
        value: lines.join('; '),
        provenance: 'manual'
      }
    ],
    provenance: [
      ...card.provenance,
      { source: 'manual', detail: t(locale, 'herbse.schedule.prov') }
    ]
  };
}
