/**
 * Phase 33C spread confirm (M-43 to M-46). Before a fertility application
 * spreads a manure or compost batch, decide whether to ask: the batch is
 * "may carry" or "not known" now and the block is sensitive. Advisory,
 * never a gate: a confirmed request always saves.
 */

import { getBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { getBatch } from '$lib/db/amendments';
import { getRegistry } from '$lib/server/registry';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { farmTimeZone } from '$lib/db/userProfile';
import {
  factsHash,
  pathSentence,
  stateLabel,
  type CarryoverState
} from '$lib/amendments/carryover';
import {
  HARMS_TEXT,
  promptsFor,
  reasonText,
  sensitiveTarget,
  type CarryoverAck,
  type CarryoverConfirmBody
} from '$lib/amendments/spreadPrompt';
import { listBioassays } from '$lib/db/amendments';
import { ymdInZone } from '$lib/prefs';

export type SpreadDecision =
  | { kind: 'save'; ack: null }
  | { kind: 'confirm'; body: CarryoverConfirmBody }
  | {
      kind: 'confirmed';
      ack: Omit<CarryoverAck, 'confirmedById' | 'confirmedByName' | 'confirmedAt'>;
    };

async function targetOf(blockId: string) {
  const block = getBlock(blockId);
  const area = block?.fieldId ? getField(block.fieldId) : undefined;
  const registry = await getRegistry();
  return sensitiveTarget({
    areaKind: area?.kind ?? null,
    plantings: (block?.plantings ?? []).map((p) => {
      const plugin = registry.get(p.cropPluginId)?.plugin;
      const family =
        plugin && plugin.type === 'crop' && typeof plugin.cropFamily === 'string'
          ? plugin.cropFamily
          : null;
      return { status: p.status ?? 'active', family };
    })
  });
}

export async function decideSpread(input: {
  blockId: string;
  batchId: string;
  confirm: string | undefined;
  now?: number;
}): Promise<SpreadDecision> {
  const now = input.now ?? Date.now();
  const data = await loadCarryoverData(now);
  const chain = data.chains.get(input.batchId);
  const batch = getBatch(input.batchId);
  if (!chain || !batch || !promptsFor(chain.state)) return { kind: 'save', ack: null };
  const target = await targetOf(input.blockId);
  if (!target.sensitive) return { kind: 'save', ack: null };
  const state = chain.state as Exclude<CarryoverState, 'none-on-file'>;
  const hash = factsHash(chain);
  if (input.confirm === hash) {
    return {
      kind: 'confirmed',
      ack: {
        v: 1,
        batchId: batch.id,
        batchName: batch.name,
        state,
        factsHash: hash,
        paths: chain.paths,
        reasons: target.reasons,
        families: target.families
      }
    };
  }
  const timeZone = farmTimeZone();
  const newestInput = data.inputs
    .filter((i) => i.batchId === batch.id)
    .reduce<number | null>((m, i) => (m === null || i.createdAt > m ? i.createdAt : m), null);
  const fromDay = newestInput === null ? null : ymdInZone(newestInput, timeZone);
  const bioassays = listBioassays({ batchId: batch.id })
    .filter((b) => fromDay === null || ymdInZone(b.testedAt, timeZone) >= fromDay)
    .map((b) => ({ id: b.id, testedOn: ymdInZone(b.testedAt, timeZone), result: b.result }));
  const message =
    state === 'may-carry'
      ? `${batch.name} may carry a weed killer that harms ${HARMS_TEXT}. Check the facts below before you spread it here.`
      : `Whether ${batch.name} carries a weed killer that harms ${HARMS_TEXT} is not known. Check the facts below before you spread it here.`;
  return {
    kind: 'confirm',
    body: {
      error: 'CARRYOVER_CONFIRM',
      message,
      batch: { id: batch.id, name: batch.name },
      state,
      stateLabel: stateLabel(state),
      paths: chain.paths,
      pathSentences: chain.paths.map((p) => pathSentence(p, timeZone)),
      morePaths: chain.morePaths,
      standingNotes: chain.standingNotes,
      reasons: target.reasons,
      reasonTexts: target.reasons.map(reasonText),
      families: target.families,
      bioassays,
      factsHash: hash
    }
  };
}
