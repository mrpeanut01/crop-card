import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { getFertilityApplication } from '$lib/db/fertility';
import { listBatchSpreads, listBioassays, listDismissals } from '$lib/db/amendments';
import { farmTimeZone } from '$lib/db/userProfile';
import { memberNamesByIds } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { buildCarryoverLines } from '$lib/farm/areaCarryover';
import { stateChip, type CarryoverState } from '$lib/amendments/carryover';
import { parseCarryoverAck } from '$lib/amendments/spreadPrompt';
import { DEFAULT_PREFS, todayYmd, ymdInZone } from '$lib/prefs';
import { t } from '$lib/i18n';

/** Phase 33C (M-47 to M-50): one block's after-spread lines, the pea or
 *  bean tests on it, and the owner's dismissals. Every role reads it. */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals?.locale;
  const block = getBlock(event.params.id);
  if (!block) error(404, t(locale, 'carry.page.blockNotFound'));
  const area = block.fieldId ? getField(block.fieldId) : undefined;
  const user = currentUser(event);
  const timeZone = farmTimeZone();
  const now = Date.now();

  const spreads = listBatchSpreads().filter((s) => s.blockId === block.id);
  const data = spreads.length ? await loadCarryoverData(now) : null;
  const states = new Map<string, CarryoverState>();
  for (const [id, chain] of data?.chains ?? []) states.set(id, chain.state);
  const batchNames = new Map((data?.batches ?? []).map((b) => [b.id, b.name]));
  const newestInputAt = new Map<string, number>();
  for (const i of data?.inputs ?? []) {
    const prev = newestInputAt.get(i.batchId);
    if (prev === undefined || i.createdAt > prev) newestInputAt.set(i.batchId, i.createdAt);
  }
  const dismissals = listDismissals({ blockId: block.id });
  const bioassays = listBioassays({ blockId: block.id });
  const batchIds = [...new Set(spreads.map((s) => s.batchId))];
  const batchTests = batchIds.flatMap((id) => listBioassays({ batchId: id }));
  const lines =
    buildCarryoverLines({
      spreads,
      states,
      batchNames,
      newestInputAt,
      bioassays: [...bioassays, ...batchTests],
      dismissedApplicationIds: new Set(dismissals.map((d) => d.fertilityApplicationId)),
      timeZone
    })[block.id] ?? [];

  const names = memberNamesByIds(
    [...dismissals.map((d) => d.createdBy), ...bioassays.map((b) => b.createdBy)].filter(
      (v): v is string => !!v
    )
  );
  const day = (ms: number) => ymdInZone(ms, timeZone);

  return {
    block: { id: block.id, name: block.name },
    area: area ? { id: area.id, name: area.name } : null,
    timeZone,
    today: todayYmd({ ...DEFAULT_PREFS, timeZone }, now),
    lines,
    spreads: spreads.map((s) => {
      const state = states.get(s.batchId) ?? 'none-on-file';
      const ack = parseCarryoverAck(getFertilityApplication(s.applicationId)?.carryoverAckJson);
      const dismissal = dismissals.find((d) => d.fertilityApplicationId === s.applicationId);
      return {
        applicationId: s.applicationId,
        batchId: s.batchId,
        batchName: batchNames.get(s.batchId) ?? t(locale, 'carry.page.unknownBatch'),
        spreadOn: day(s.occurredAt),
        state,
        stateText: stateChip(state, locale),
        ack: ack
          ? {
              by: ack.confirmedByName,
              on: day(ack.confirmedAt),
              stateText: stateChip(ack.state, locale)
            }
          : null,
        dismissal: dismissal
          ? {
              id: dismissal.id,
              reason: dismissal.reason,
              on: day(dismissal.createdAt),
              by:
                (dismissal.createdBy && names.get(dismissal.createdBy)) ||
                t(locale, 'carry.page.theOwner')
            }
          : null
      };
    }),
    bioassays: bioassays.map((b) => ({
      id: b.id,
      testedOn: day(b.testedAt),
      result: b.result,
      note: b.note,
      by: (b.createdBy && names.get(b.createdBy)) || null
    })),
    isOwner: user?.role === 'owner',
    canRecord: !!user && canMutate(user.role)
  };
};
