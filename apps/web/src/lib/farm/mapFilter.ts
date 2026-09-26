import { AREA_KINDS, isAreaKind, type AreaKind } from './areaKinds';
import { MAP_FEATURE_KINDS, type MapFeatureKind } from './mapFeatures';

/** Per-Owner map layer choices, kept in the browser only. */
export interface MapFilter {
  hidden: AreaKind[];
  hiddenFeatures: MapFeatureKind[];
  shade: boolean;
  labels: boolean;
  satellite: boolean;
}

export const DEFAULT_MAP_FILTER: Readonly<MapFilter> = {
  hidden: [],
  hiddenFeatures: [],
  shade: true,
  labels: true,
  satellite: true
};

const KEY = 'cropcard.map-filter.v1';

export function mapFilterKey(ownerId: string | null | undefined): string | null {
  return ownerId ? `${KEY}:${ownerId}` : null;
}

export function parseMapFilter(raw: unknown): MapFilter {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MAP_FILTER, hidden: [], hiddenFeatures: [] };
  }
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const hidden = Array.isArray(r.hidden)
    ? AREA_KINDS.filter((k) => (r.hidden as unknown[]).includes(k))
    : [];
  const hiddenFeatures = Array.isArray(r.hiddenFeatures)
    ? MAP_FEATURE_KINDS.filter((k) => (r.hiddenFeatures as unknown[]).includes(k))
    : [];
  return {
    hidden,
    hiddenFeatures,
    shade: bool(r.shade, DEFAULT_MAP_FILTER.shade),
    labels: bool(r.labels, DEFAULT_MAP_FILTER.labels),
    satellite: bool(r.satellite, DEFAULT_MAP_FILTER.satellite)
  };
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): KV | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadMapFilter(ownerId: string | null | undefined, store = storage()): MapFilter {
  const key = mapFilterKey(ownerId);
  if (!key || !store) return parseMapFilter(null);
  try {
    const raw = store.getItem(key);
    return parseMapFilter(raw ? JSON.parse(raw) : null);
  } catch {
    return parseMapFilter(null);
  }
}

export function saveMapFilter(
  ownerId: string | null | undefined,
  filter: MapFilter,
  store = storage()
): void {
  const key = mapFilterKey(ownerId);
  if (!key || !store) return;
  try {
    store.setItem(key, JSON.stringify(parseMapFilter(filter)));
  } catch {
    // Storage full or blocked; the filter just won't persist.
  }
}

export function isKindVisible(filter: MapFilter, kind: string | null | undefined): boolean {
  const k = isAreaKind(kind) ? kind : 'field';
  return !filter.hidden.includes(k);
}

export function toggleKind(filter: MapFilter, kind: AreaKind): MapFilter {
  const hidden = filter.hidden.includes(kind)
    ? filter.hidden.filter((k) => k !== kind)
    : [...filter.hidden, kind];
  return { ...filter, hidden: AREA_KINDS.filter((k) => hidden.includes(k)) };
}

export function isFeatureVisible(filter: MapFilter, kind: MapFeatureKind): boolean {
  return !filter.hiddenFeatures.includes(kind);
}

export function toggleFeatureKind(filter: MapFilter, kind: MapFeatureKind): MapFilter {
  const hidden = filter.hiddenFeatures.includes(kind)
    ? filter.hiddenFeatures.filter((k) => k !== kind)
    : [...filter.hiddenFeatures, kind];
  return { ...filter, hiddenFeatures: MAP_FEATURE_KINDS.filter((k) => hidden.includes(k)) };
}

export function isFilterActive(filter: MapFilter): boolean {
  return (
    filter.hidden.length > 0 ||
    filter.hiddenFeatures.length > 0 ||
    !filter.shade ||
    !filter.labels ||
    !filter.satellite
  );
}
