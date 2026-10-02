/** Client-safe shapes the amendment pages render (33C). */

import type { CarryoverState } from './carryover';
import type { BatchKind, BatchOrigin } from './model';

export interface AmendmentRow {
  id: string;
  name: string;
  kind: BatchKind;
  origin: BatchOrigin;
  state: CarryoverState;
  startedAt: number;
  closedAt: number | null;
  inputCount: number;
  supplier: string | null;
}
