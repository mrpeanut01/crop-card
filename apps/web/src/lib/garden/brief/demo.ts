import type { BriefAnswers, GardenBrief } from './schema';
import { deterministicShortlist } from './shortlist';

/** Willow Run's garden brief (R-15, C-10). Pure: the close-out seeder
 *  saves it as the demo Owner's `garden_brief` setting. */
export function demoGardenBrief(nowMs: number): GardenBrief {
  const answers: BriefAnswers = {
    why: { value: ['cooking', 'tea'], notSure: false, provenance: 'manual' },
    cuisines: { value: ['italian'], notSure: false, provenance: 'manual' },
    wanted: { value: ['chives-common'], notSure: false, provenance: 'manual' },
    avoid: { value: [], notSure: false, provenance: 'manual' },
    time: { value: '1-2h', notSure: false, provenance: 'manual' },
    sun: { value: 'full', notSure: false, provenance: 'manual' },
    where: { value: ['raised'], notSure: false, provenance: 'manual' },
    storage: {
      value: [
        { goal: 'dry', target: 'enough dried oregano for the year' },
        { goal: 'pesto', target: 'a dozen pesto portions' },
        { goal: 'fresh' }
      ],
      notSure: false,
      provenance: 'manual'
    }
  };
  return {
    version: 1,
    answers,
    shortlist: deterministicShortlist(answers).rows,
    chatTurns: 0,
    updatedAt: nowMs
  };
}
