/** Client-safe shapes for the money entry form. */

import type { LedgerKind } from './categories';

export interface LinkOption {
  id: string;
  label: string;
}

export interface EntryFormOptions {
  plantings: LinkOption[];
  areas: LinkOption[];
  beds: Array<LinkOption & { fieldId: string }>;
  groups: LinkOption[];
  animals: LinkOption[];
  timeZone: string;
}

export interface EntryFormValue {
  id?: string;
  kind: LedgerKind;
  occurredAt: number;
  amountCents: number | null;
  category: string;
  description: string | null;
  cropId: string | null;
  fieldId: string | null;
  blockId: string | null;
  animalId: string | null;
  animalGroupId: string | null;
  stockLotId: string | null;
  harvestEventId: string | null;
  /** "Also record the money" from a disposition (Phase 33B, B-31). */
  dispositionId?: string | null;
  enterprise: string | null;
  quantity: number | null;
  unit: string | null;
}
