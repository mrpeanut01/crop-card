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
import { zoneCardValue, zoneSourceDetail } from '$lib/climate/zone';
import { AREA_KINDS, isCropBearing } from '$lib/farm/areaKinds';
import { AREA_KIND_PLURAL, AREA_KIND_STYLE } from '$lib/farm/kindStyle';
import {
  areaDisplayName,
  areaKindLabel,
  monthDay,
  resolveOptions,
  trimNumber,
  type ResolvedOptions
} from './common';
import { t, type MessageKey } from '$lib/i18n';
import type { AreaKind } from '$lib/farm/areaKinds';
import { formatAreaAcres, formatSize } from './size';
import { formatQuantity, type Prefs } from '$lib/prefs';
import {
  MAP_FEATURE_KINDS,
  MAP_FEATURE_LABELS,
  MAP_FEATURE_PLURAL,
  MAP_FEATURE_STYLE,
  describeFeature,
  servedAreaIds,
  servesManyAreas,
  type MapFeatureKind
} from '$lib/farm/mapFeatures';
import { formatEmergencyContact, type EmergencyContact } from '$lib/farm/emergencyContacts';

export type { EmergencyContact };

export interface FarmMapBuildOptions {
  prefs?: Prefs;
  now?: number;
  /** The app language; defaults to `prefs.locale`. */
  locale?: string | null;
  /** Overrides the snapshot's saved contacts; the section is left off when none exist. */
  emergencyContacts?: readonly EmergencyContact[];
  /** Line and point kinds the printed figure actually draws. Given, the
   *  legend names the others as listed but not drawn. */
  drawnFeatureKinds?: readonly MapFeatureKind[];
}

const MAX_PER_KIND = 6;

function mmDd(value: string | null | undefined, locale?: string | null): string | null {
  if (!value || !/^\d{2}-\d{2}$/.test(value)) return null;
  return monthDay(`2000-${value}`, locale);
}

function kindPlural(kind: AreaKind, locale?: string | null): string {
  return locale ? t(locale, `farm.kindPlural.${kind}`) : AREA_KIND_PLURAL[kind];
}

function featureLabel(kind: MapFeatureKind, locale?: string | null): string {
  return locale ? t(locale, `farm.feat.${kind}`) : MAP_FEATURE_LABELS[kind];
}

function featurePlural(kind: MapFeatureKind, locale?: string | null): string {
  return locale ? t(locale, `farm.featPlural.${kind}`) : MAP_FEATURE_PLURAL[kind];
}

function kindColor(kind: AreaKind, locale?: string | null): string {
  return locale
    ? t(locale, `cards.color.area.${kind}` as MessageKey)
    : AREA_KIND_STYLE[kind].colorName;
}

function featureColor(kind: MapFeatureKind, locale?: string | null): string {
  return locale
    ? t(locale, `cards.color.feat.${kind}` as MessageKey)
    : MAP_FEATURE_STYLE[kind].colorName;
}

function frostFacts(
  frost: SnapshotFrostDates | null,
  opts: ResolvedOptions
): {
  facts: CardFact[];
  provenance: CardProvenance[];
} {
  if (!frost) return { facts: [], provenance: [] };
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const source = frost.provenance;
  const detail =
    source === 'data' && frost.stationName
      ? frost.distanceMi !== null
        ? `${frost.stationName}, ${trimNumber(frost.distanceMi, 0)} mi`
        : frost.stationName
      : source === 'fallback'
        ? tr('cards.map.loudounDefaults')
        : source === 'manual'
          ? tr('cards.map.yourDates')
          : undefined;
  if (frost.frostFree) {
    return {
      facts: [{ label: tr('cards.map.frost'), value: tr('cards.map.frostFree'), provenance: source }],
      provenance: [{ source, detail }]
    };
  }
  const facts: CardFact[] = [];
  const last = mmDd(frost.lastSpring, loc);
  const first = mmDd(frost.firstFall, loc);
  if (last) facts.push({ label: tr('cards.map.lastFrost'), value: last, provenance: source });
  if (first) facts.push({ label: tr('cards.map.firstFrost'), value: first, provenance: source });
  const hardLast = mmDd(frost.hardLastSpring, loc);
  const hardFirst = mmDd(frost.hardFirstFall, loc);
  if (hardLast && hardFirst) {
    facts.push({
      label: tr('cards.map.hardFrost'),
      value: `${hardLast} · ${hardFirst}`,
      provenance: source
    });
  }
  return { facts, provenance: facts.length ? [{ source, detail }] : [] };
}

function areaLine(area: SnapshotArea, prefs: Prefs): string {
  const size = formatSize(area, prefs);
  const name = areaDisplayName(area, prefs.locale);
  return size ? `${name} · ${size}` : name;
}

/** The whole farm on one card: Areas by kind, a color legend, frost dates and,
 *  when the owner saved them, who to call. Pure; runs on the server and offline. */
export function buildFarmMapCard(
  snapshot: FarmSnapshot,
  options: FarmMapBuildOptions = {}
): CardModel {
  const opts = resolveOptions(snapshot, options);
  const { prefs, tr } = opts;
  const loc = prefs.locale;
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

  facts.push({ label: tr('cards.map.areas'), value: String(areas.length), provenance: 'data' });
  if (cropAcres > 0) {
    facts.push({
      label: tr('cards.map.growingSize'),
      value: formatAreaAcres(cropAcres, prefs),
      provenance: 'data'
    });
  }
  if (areas.length) provenance.push({ source: 'data', detail: tr('cards.prov.yourMap') });

  const frost = frostFacts(snapshot.frost, opts);
  facts.push(...frost.facts);
  provenance.push(...frost.provenance);

  if (snapshot.zone) {
    facts.push({
      label: tr('cards.map.zone'),
      value: zoneCardValue(snapshot.zone, loc),
      provenance: snapshot.zone.provenance
    });
    provenance.push({
      source: snapshot.zone.provenance,
      detail:
        snapshot.zone.provenance === 'data'
          ? tr('cards.map.zoneApprox', { detail: String(zoneSourceDetail(snapshot.zone, loc)) })
          : zoneSourceDetail(snapshot.zone, loc)
    });
  }

  const sections: CardSection[] = [];
  for (const kind of kindsPresent) {
    const ofKind = areas
      .filter((a) => a.kind === kind)
      .sort((a, b) =>
        areaDisplayName(a).localeCompare(areaDisplayName(b), 'en', { numeric: true })
      );
    const items = ofKind.slice(0, MAX_PER_KIND).map((a) => areaLine(a, prefs));
    if (ofKind.length > MAX_PER_KIND)
      items.push(tr('cards.more', { count: ofKind.length - MAX_PER_KIND }));
    sections.push({ title: kindPlural(kind, loc), items });
  }

  const features = snapshot.mapFeatures ?? [];
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const featureKinds = MAP_FEATURE_KINDS.filter((k) => features.some((f) => f.kind === k));
  const lengthText = (ft: number) => formatQuantity(ft, 'distance', prefs, { digits: 0 });
  for (const kind of featureKinds) {
    const ofKind = features
      .filter((f) => f.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const items = ofKind.slice(0, MAX_PER_KIND).map((f) => {
      const named = loc && !f.name.trim() ? { ...f, name: featureLabel(f.kind, loc) } : f;
      const line = describeFeature(named, lengthText, loc);
      if (!servesManyAreas(f.kind)) return line;
      const served = servedAreaIds(f)
        .map((id) => areaById.get(id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => areaDisplayName(a, loc));
      return served.length
        ? tr('cards.map.serves', { line, areas: served.join(', ') })
        : line;
    });
    if (ofKind.length > MAX_PER_KIND)
      items.push(tr('cards.more', { count: ofKind.length - MAX_PER_KIND }));
    sections.push({ title: featurePlural(kind, loc), items });
  }
  if (features.length && !areas.length)
    provenance.push({ source: 'data', detail: tr('cards.prov.yourMap') });

  if (kindsPresent.length || featureKinds.length) {
    sections.push({
      title: tr('cards.map.legend'),
      items: [
        ...kindsPresent.map((k) => `${areaKindLabel(k, loc)}: ${kindColor(k, loc)}`),
        ...featureKinds.map((k) =>
          !options.drawnFeatureKinds || options.drawnFeatureKinds.includes(k)
            ? `${featureLabel(k, loc)}: ${featureColor(k, loc)}`
            : tr('cards.map.notDrawn', { label: featureLabel(k, loc) })
        )
      ]
    });
  }

  const contacts = (options.emergencyContacts ?? snapshot.emergencyContacts ?? []).filter(
    (c) => c.name.trim() && c.phone.trim()
  );
  if (contacts.length) {
    sections.unshift({
      title: tr('cards.map.emergencyContacts'),
      items: contacts.map((c) =>
        formatEmergencyContact(
          loc && c.type === 'vet' && !c.role.trim() ? { ...c, role: tr('cards.animal.vet') } : c
        )
      ),
      nowrapAfter: ': '
    });
  }

  if (!areas.length && !features.length) {
    sections.push({ title: tr('cards.map.areas'), items: [tr('cards.map.nothingYet')] });
  }

  const key = cardKey('farmMap', snapshot.ownerId);
  const count = areas.length;
  return {
    kind: 'farmMap',
    key,
    kicker: tr('cards.map.kicker', { count }),
    title: snapshot.farmName?.trim() || tr('cards.map.yourFarm'),
    facts,
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('farmMap', key)
  };
}
