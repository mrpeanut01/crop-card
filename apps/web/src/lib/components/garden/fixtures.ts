import { buildGardenDesign, type DesignInput, type DesignPlantingInput } from '$lib/garden/design';
import type { GardenCrop, GardenDesign } from '$lib/garden/types';

export const TOMATO: GardenCrop = {
  pluginId: 'tomato-celebrity-f1',
  displayName: 'Tomato Celebrity F1 (AAS Winner)',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 70, max: 75 },
  defaultRowSpacingInches: 48,
  plantingGuide: { rowSpacingIn: 48, inRowSpacingIn: { min: 24, max: 36 } }
};

export const LETTUCE: GardenCrop = {
  pluginId: 'lettuce-buttercrunch',
  displayName: 'Lettuce — Buttercrunch (Bibb)',
  cropFamily: 'leafy-green',
  archetype: 'cut-and-come-again-leafy',
  daysToMaturity: { min: 50, max: 60 },
  defaultRowSpacingInches: 12
};

export const CATALOG: GardenCrop[] = [LETTUCE, TOMATO];

export function plantingRow(over: Partial<DesignPlantingInput>): DesignPlantingInput {
  return {
    id: 'p',
    blockId: 'bed1',
    cropPluginId: TOMATO.pluginId,
    varietyDisplayName: TOMATO.displayName,
    status: 'planned',
    plantingDateMs: Date.UTC(2026, 4, 1),
    harvestedAtMs: null,
    footprint: null,
    spacingIn: null,
    rowSpacingIn: null,
    spacingPattern: 'square',
    plantCount: null,
    plantCountProvenance: null,
    groupId: null,
    groupSystemKind: null,
    ...over
  };
}

/** The household gardener's 20 × 30 ft kitchen garden with two 4 × 8 beds. */
export function kitchenGarden(over: Partial<DesignInput> = {}): GardenDesign {
  return buildGardenDesign({
    area: {
      id: 'area1',
      name: 'Kitchen Garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30,
      geojson: null
    },
    blocks: [
      {
        id: 'bed1',
        name: 'Bed 1',
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 3,
        rotationDeg: 0,
        bedStyle: 'raised'
      },
      {
        id: 'bed2',
        name: 'Bed 2',
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 8,
        yFt: 3,
        rotationDeg: 0,
        bedStyle: 'raised'
      }
    ],
    plantings: [],
    crops: { [TOMATO.pluginId]: TOMATO, [LETTUCE.pluginId]: LETTUCE },
    frost: {
      lastSpringFrostMs: Date.UTC(2026, 3, 15),
      firstFallFrostMs: Date.UTC(2026, 9, 24),
      provenance: 'fallback'
    },
    seasonYear: 2026,
    asOf: Date.UTC(2026, 4, 1),
    readOnlyReason: null,
    ...over
  })!;
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch stand-in that records calls and answers from `handler`. */
export function fakeFetch(
  handler: (call: FetchCall) => { status?: number; body?: unknown } | 'offline'
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    };
    calls.push(call);
    const out = handler(call);
    if (out === 'offline') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(out.body ?? {}), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}
