/**
 * Builds the designer's view model. The server loader and the offline
 * snapshot path both end here so the page renders the same either way.
 */

import type { FarmSnapshot } from '$lib/cards/snapshot';
import type { GardenDesign } from './types';

export interface DesignOptions {
  seasonYear: number;
  readOnlyReason: GardenDesign['readOnlyReason'];
}

function notImplemented(name: string): never {
  throw new Error(`lib/garden/design.${name}: not implemented`);
}

/** Null when the Area is missing from the snapshot or is not a garden or
 *  greenhouse. Beds without a stored position are laid out with `freeSpot`
 *  in name order and shown as "not placed yet" until moved. */
export function designFromSnapshot(
  _snapshot: FarmSnapshot,
  _areaId: string,
  _opts: DesignOptions
): GardenDesign | null {
  return notImplemented('designFromSnapshot');
}
