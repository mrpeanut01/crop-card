/**
 * Phase 33C spread warnings (M-43 to M-46). Pure and client-safe: decides
 * whether the block a manure or compost batch is going onto is sensitive
 * to a carryover weed killer, and the shape of the stored confirmation.
 * Advisory only; the kernel is not consulted for a verdict, only for the
 * list of crop families the synthetic-auxin class damages.
 */

import { CHEMISTRY_KILL_MATRIX } from '$lib/safety/cropFamilyLethality';
import type { CarryoverChain, CarryoverPath, CarryoverState } from './carryover';

export type CarryoverReason =
  'garden-area' | 'greenhouse-area' | 'sensitive-crop' | 'unknown-family';

const SENSITIVE_FAMILIES: ReadonlySet<string> = new Set(
  CHEMISTRY_KILL_MATRIX['synthetic-auxin'].killsFamilies
);

/** True for a crop family the carryover class damages, or no known family. */
export function isSensitiveFamily(family: string | null | undefined): boolean {
  return !family || SENSITIVE_FAMILIES.has(family);
}

const LIVE_STATUSES = new Set(['planned', 'active']);

/** M-44: the block's Area is a garden or greenhouse, or a planned or
 *  active planting is in a damaged family or has no known family. */
export function sensitiveTarget(input: {
  areaKind: string | null;
  plantings: Array<{ status: string; family: string | null }>;
}): { sensitive: boolean; reasons: CarryoverReason[]; families: string[] } {
  const reasons: CarryoverReason[] = [];
  if (input.areaKind === 'garden') reasons.push('garden-area');
  if (input.areaKind === 'greenhouse') reasons.push('greenhouse-area');
  const families = new Set<string>();
  let unknown = false;
  for (const p of input.plantings) {
    if (!LIVE_STATUSES.has(p.status)) continue;
    if (!p.family) unknown = true;
    else if (SENSITIVE_FAMILIES.has(p.family)) families.add(p.family);
  }
  if (families.size) reasons.push('sensitive-crop');
  if (unknown) reasons.push('unknown-family');
  return { sensitive: reasons.length > 0, reasons, families: [...families].sort() };
}

export function promptsFor(state: CarryoverState): boolean {
  return state === 'may-carry' || state === 'not-known';
}

const REASON_TEXT: Record<CarryoverReason, string> = {
  'garden-area': 'This block is in a garden.',
  'greenhouse-area': 'This block is in a greenhouse.',
  'sensitive-crop': 'A crop planned or growing here is one these weed killers damage.',
  'unknown-family': 'A crop planned or growing here has no known crop family.'
};

export function reasonText(reason: CarryoverReason): string {
  return REASON_TEXT[reason];
}

/** What a carryover weed killer harms, for the prompt and the block line. */
export const HARMS_TEXT = 'tomatoes, beans, peas and other broadleaf crops';

export interface CarryoverAck {
  v: 1;
  batchId: string;
  batchName: string;
  state: CarryoverState;
  factsHash: string;
  paths: CarryoverPath[];
  reasons: CarryoverReason[];
  families: string[];
  confirmedById: string;
  confirmedByName: string;
  confirmedAt: number;
}

export function parseCarryoverAck(raw: string | null | undefined): CarryoverAck | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as CarryoverAck;
    return v && v.v === 1 && typeof v.batchId === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Body of the 409 `CARRYOVER_CONFIRM` answer (M-45, M-63). */
export interface CarryoverConfirmBody {
  error: 'CARRYOVER_CONFIRM';
  message: string;
  batch: { id: string; name: string };
  state: Exclude<CarryoverState, 'none-on-file'>;
  stateLabel: string;
  paths: CarryoverChain['paths'];
  pathSentences: string[];
  morePaths: number;
  standingNotes: string[];
  reasons: CarryoverReason[];
  reasonTexts: string[];
  families: string[];
  bioassays: Array<{ id: string; testedOn: string; result: 'no-damage' | 'damage' }>;
  factsHash: string;
}
