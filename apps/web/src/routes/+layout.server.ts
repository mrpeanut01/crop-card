import type { LayoutServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';

export const load: LayoutServerLoad = ({ locals }) => {
  // A sprayer is "dirty" when it has carried chemistry that has not yet been
  // followed by a decon. Surfaced as a site-wide banner so an operator can't
  // forget — the kernel will block the next spray on this sprayer anyway,
  // but a visible reminder beats a STOP card mid-mix (FR-05).
  const sprayers = listSprayers();
  const dirtySprayers = sprayers
    .filter((s) => {
      if (!s.lastChemistryClass) return false;
      if (!s.lastSprayedAt) return false;
      if (s.lastDeconAt && s.lastDeconAt >= s.lastSprayedAt) return false;
      return true;
    })
    .map((s) => ({
      id: s.id,
      label: s.label,
      lastChemistryClass: s.lastChemistryClass
    }));

  return {
    user: locals.user ?? null,
    dirtySprayers
  };
};
