import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotArea, SnapshotFrostDates } from '../snapshot';
import { AREA_KINDS, isCropBearing } from '$lib/farm/areaKinds';
import { AREA_KIND_PLURAL, AREA_KIND_STYLE } from '$lib/farm/kindStyle';
import { areaDisplayName, areaKindLabel, monthDay, resolveOptions, trimNumber } from './common';
import { formatAreaAcres, formatSize } from './size';
import { formatQuantity, type Prefs } from '$lib/prefs';
import {
  MAP_FEATURE_KINDS,
  MAP_FEATURE_LABELS,
  MAP_FEATURE_PLURAL,
  MAP_FEATURE_STYLE,
  describeFeature
} from '$lib/farm/mapFeatures';

export interface EmergencyContact {
  label: string;
  phone: string;
}

export interface FarmMapBuildOptions {
  prefs?: Prefs;
  now?: number;
  /** Only shown when the owner has saved some; the section is left off otherwise. */
  emergencyContacts?: readonly EmergencyContact[];
}

const MAX_PER_KIND = 6;

function mmDd(value: string | null | undefined): string | null {
  if (!value || !/^\d{2}-\d{2}$/.test(value)) return null;
  return monthDay(`2000-${value}`);
}

function frostFacts(frost: SnapshotFrostDates | null): {
  facts: CardFact[];
  provenance: CardProvenance[];
} {
  if (!frost) return { facts: [], provenance: [] };
  const source = frost.provenance;
  const detail =
    source === 'data' && frost.stationName
      ? frost.distanceMi !== null
        ? `${frost.stationName}, ${trimNumber(frost.distanceMi, 0)} mi`
        : frost.stationName
      : source === 'fallback'
        ? 'Loudoun defaults'
        : source === 'manual'
          ? 'your dates'
          : undefined;
  if (frost.frostFree) {
    return {
      facts: [{ label: 'Frost', value: 'Frost-free', provenance: source }],
      provenance: [{ source, detail }]
    };
  }
  const facts: CardFact[] = [];
  const last = mmDd(frost.lastSpring);
  const first = mmDd(frost.firstFall);
  if (last) facts.push({ label: 'Last frost', value: last, provenance: source });
  if (first) facts.push({ label: 'First frost', value: first, provenance: source });
  const hardLast = mmDd(frost.hardLastSpring);
  const hardFirst = mmDd(frost.hardFirstFall);
  if (hardLast && hardFirst) {
    facts.push({ label: 'Hard frost', value: `${hardLast} · ${hardFirst}`, provenance: source });
  }
  return { facts, provenance: facts.length ? [{ source, detail }] : [] };
}

function areaLine(area: SnapshotArea, prefs: Prefs): string {
  const size = formatSize(area, prefs);
  return size ? `${areaDisplayName(area)} · ${size}` : areaDisplayName(area);
}

/** The whole farm on one card: Areas by kind, a color legend, frost dates and,
 *  when the owner saved them, who to call. Pure; runs on the server and offline. */
export function buildFarmMapCard(
  snapshot: FarmSnapshot,
  options: FarmMapBuildOptions = {}
): CardModel {
  const { prefs } = resolveOptions(snapshot, options);
  const facts: CardFact[] = [];
  const provenance: CardProvenance[] = [];
  const areas = snapshot.areas;

  const kindsPresent = AREA_KINDS.filter((k) => areas.some((a) => a.kind === k));
  const cropAcres = areas
    .filter((a) => isCropBearing(a.kind))
    .reduce((sum, a) => {
      if (a.acres !== null && a.acres > 0) return sum + a.acres;
      if (a.widthFt && a.lengthFt) return sum + (a.widthFt * a.lengthFt) / 43_560;
      return sum;
    }, 0);

  facts.push({ label: 'Areas', value: String(areas.length), provenance: 'data' });
  if (cropAcres > 0) {
    facts.push({
      label: 'Growing size',
      value: formatAreaAcres(cropAcres, prefs),
      provenance: 'data'
    });
  }
  if (areas.length) provenance.push({ source: 'data', detail: 'your map' });

  const frost = frostFacts(snapshot.frost);
  facts.push(...frost.facts);
  provenance.push(...frost.provenance);

  const sections: CardSection[] = [];
  for (const kind of kindsPresent) {
    const ofKind = areas
      .filter((a) => a.kind === kind)
      .sort((a, b) =>
        areaDisplayName(a).localeCompare(areaDisplayName(b), 'en', { numeric: true })
      );
    const items = ofKind.slice(0, MAX_PER_KIND).map((a) => areaLine(a, prefs));
    if (ofKind.length > MAX_PER_KIND) items.push(`+${ofKind.length - MAX_PER_KIND} more`);
    sections.push({ title: AREA_KIND_PLURAL[kind], items });
  }

  const features = snapshot.mapFeatures ?? [];
  const featureKinds = MAP_FEATURE_KINDS.filter((k) => features.some((f) => f.kind === k));
  const lengthText = (ft: number) => formatQuantity(ft, 'distance', prefs, { digits: 0 });
  for (const kind of featureKinds) {
    const ofKind = features
      .filter((f) => f.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const items = ofKind.slice(0, MAX_PER_KIND).map((f) => describeFeature(f, lengthText));
    if (ofKind.length > MAX_PER_KIND) items.push(`+${ofKind.length - MAX_PER_KIND} more`);
    sections.push({ title: MAP_FEATURE_PLURAL[kind], items });
  }
  if (features.length && !areas.length) provenance.push({ source: 'data', detail: 'your map' });

  if (kindsPresent.length || featureKinds.length) {
    sections.push({
      title: 'Legend',
      items: [
        ...kindsPresent.map((k) => `${areaKindLabel(k)}: ${AREA_KIND_STYLE[k].colorName}`),
        ...featureKinds.map((k) => `${MAP_FEATURE_LABELS[k]}: ${MAP_FEATURE_STYLE[k].colorName}`)
      ]
    });
  }

  const contacts = (options.emergencyContacts ?? []).filter(
    (c) => c.label.trim() && c.phone.trim()
  );
  if (contacts.length) {
    sections.unshift({
      title: 'Emergency contacts',
      items: contacts.map((c) => `${c.label.trim()}: ${c.phone.trim()}`)
    });
  }

  if (!areas.length && !features.length) {
    sections.push({ title: 'Areas', items: ['Nothing on the map yet.'] });
  }

  const key = cardKey('farmMap', snapshot.ownerId);
  const count = areas.length;
  return {
    kind: 'farmMap',
    key,
    kicker: `Farm map · ${count} area${count === 1 ? '' : 's'}`,
    title: snapshot.farmName?.trim() || 'Your farm',
    facts,
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('farmMap', key)
  };
}
