import { t, type MessageKey } from '$lib/i18n';
import type { AllocationResponse, LeftoverBlockStatus, LeftoverReport } from './types';

const STATUS_KEY: Record<LeftoverBlockStatus, MessageKey> = {
  full: 'wizard.leftover.full',
  'too-small': 'wizard.leftover.tooSmall',
  'keep-apart': 'wizard.leftover.keepApart',
  rotation: 'wizard.leftover.rotation',
  'cross-pollination': 'wizard.leftover.crossPollination',
  sun: 'wizard.leftover.sun',
  narrow: 'wizard.leftover.narrow',
  'kept-in-one-bed': 'wizard.leftover.keptInOneBed'
};

/** One sentence per picked block saying why it took no more of a left-over
 *  seed (R-11). Written from the codes, never from engine diagnostics. */
export function leftoverReasons(
  report: LeftoverReport,
  names: { block: (id: string) => string; crop: (pluginId: string) => string | undefined },
  locale?: string | null
): string[] {
  return report.blocks.map((b) =>
    t(locale, STATUS_KEY[b.status] ?? 'wizard.leftover.full', {
      bed: names.block(b.blockId),
      crop:
        (b.withPluginId ? names.crop(b.withPluginId) : undefined) ??
        t(locale, 'wizard.leftover.otherCrop')
    })
  );
}

/** True when some picked block was ruled out rather than full, so keeping the
 *  crop in one bed (or letting it spread) is a real choice (R-21). */
export function leftoverHasRuledOut(report: LeftoverReport | undefined): boolean {
  return !!report && report.blocks.some((b) => b.status !== 'full');
}

export type ReviewRow = { assignment: AllocationResponse['assignments'][number]; index: number };

/** Review rows with each split lot's rows together at the lot's first row;
 *  every other row keeps server order (R-21). A plan with no split comes
 *  back in server order. */
export function groupSplitRows(
  assignments: AllocationResponse['assignments'],
  split: ReadonlyMap<string, number>
): ReviewRow[] {
  const out: ReviewRow[] = [];
  const emitted = new Set<string>();
  assignments.forEach((a, index) => {
    if (!split.has(a.stockItemId)) {
      out.push({ assignment: a, index });
      return;
    }
    if (emitted.has(a.stockItemId)) return;
    emitted.add(a.stockItemId);
    assignments.forEach((b, j) => {
      if (b.stockItemId === a.stockItemId) out.push({ assignment: b, index: j });
    });
  });
  return out;
}
