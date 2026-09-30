/**
 * The shape `GET /api/weather/degree-days` returns, shared by the route,
 * /scout and the /today card. Client-safe types only.
 */

import type { ModelStatus, ResolvedBiofix } from './pestModels';
import type { PestModelPlugin } from '$lib/plugins/schemas';

export interface DegreeDayStation {
  ghcnId: string;
  icao: string;
  label: string;
  distanceMiles: number;
}

export interface DegreeDayModelResult {
  modelId: string;
  displayName: string;
  pest: { commonName: string; scientificName: string | null };
  hostCropFamilies: string[];
  method: PestModelPlugin['method'];
  baseTempF: number;
  upperCutoffF: number | null;
  biofix: {
    kind: ResolvedBiofix['kind'];
    date: string | null;
    provenance: ResolvedBiofix['provenance'];
    recordedBy: string | null;
    acceptsManual: boolean;
  };
  totalLowerBound: number;
  missingDays: number;
  throughYmd: string | null;
  status: {
    state: ModelStatus['state'];
    stage: PestModelPlugin['stages'][number] | null;
    inWindow: boolean;
    reached: boolean | 'unknown';
    next: {
      key: string;
      label: string;
      gddFrom: number;
      remaining: number;
      uncertain: boolean;
    } | null;
  };
  lines: string[];
  applicable: boolean;
  showOnScout: boolean;
  showOnToday: boolean;
}

export type DegreeDayLocation = 'ok' | 'no-location' | 'no-station';

export interface DegreeDaysResult {
  year: number;
  location: DegreeDayLocation;
  /** Plain line for the strip when there is no count at all. */
  message: string | null;
  station: DegreeDayStation | null;
  dataError: string | null;
  models: DegreeDayModelResult[];
}
