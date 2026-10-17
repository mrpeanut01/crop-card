import { t, type TranslateKey } from '$lib/i18n';
import { seasonSetupLabel } from '$lib/season/setup';
import type { SprayWindowPurpose } from '$lib/plugins/schemas';

/** Which pool came up empty for a `no-compliant-product` warning. */
export type NoCompliantReasonCode =
  'pool' | 'by-hand' | 'approach' | 'sidedress' | 'topdress' | 'cover-terminate';

export interface NoCompliantReasonInput {
  slot: SprayWindowPurpose | 'pre-plant-fertility';
  reasonCode?: NoCompliantReasonCode;
}

function familyOf(slot: NoCompliantReasonInput['slot']): string {
  if (
    slot === 'burndown' ||
    slot === 'pre-emergent' ||
    slot === 'post-emergent' ||
    slot === 'cover-terminate'
  ) {
    return 'herbicide';
  }
  if (slot === 'insecticide-prophylactic' || slot === 'insecticide-scouted') return 'insecticide';
  if (slot === 'fungicide') return 'fungicide';
  return 'fertilizer';
}

/** A Season Setup label's lead words ("No-till — burndown …" → "no-till")
 *  for use inside a sentence. */
function inline(label: string): string {
  const head = label.split(/ — |: /)[0];
  return head.charAt(0).toLowerCase() + head.slice(1);
}

/** The sentence for a `no-compliant-product` warning in `locale`, with the
 *  season's growing approach and fertility approach as their labels. */
export function noCompliantReasonText(
  w: NoCompliantReasonInput,
  setup: { philosophy: string; fertilityApproach: string },
  locale?: string | null
): string {
  const philosophy = inline(seasonSetupLabel('philosophy', setup.philosophy, locale));
  switch (w.reasonCode) {
    case 'by-hand':
      return t(locale, 'inputs.warn.byHand.body');
    case 'approach':
      return t(locale, 'inputs.warn.reason.approach', {
        philosophy,
        approach: inline(seasonSetupLabel('fert', setup.fertilityApproach, locale))
      });
    case 'sidedress':
      return t(locale, 'inputs.warn.reason.sidedress', { philosophy });
    case 'topdress':
      return t(locale, 'inputs.warn.reason.topdress', { philosophy });
    case 'cover-terminate':
      return t(locale, 'inputs.warn.reason.coverTerminate', { philosophy });
    default:
      return t(locale, 'inputs.warn.poolReason', {
        family: t(locale, `inputs.cat.${familyOf(w.slot)}` as TranslateKey),
        philosophy,
        slot: t(locale, `inputs.slot.${w.slot}` as TranslateKey)
      });
  }
}
