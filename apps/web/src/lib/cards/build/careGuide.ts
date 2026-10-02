import { formatQuantity } from '$lib/prefs';
import { isDesignable } from '$lib/farm/areaKinds';
import {
  cardHref,
  cardKey,
  parseCardKey,
  type CardAction,
  type CardFact,
  type CardModel,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotCareTask, SnapshotCropPlugin } from '../snapshot';
import { t, type MessageKey } from '$lib/i18n';
import { cropDisplayName } from '$lib/i18n/cropName';
import {
  blockDisplayName,
  daysText,
  resolveOptions,
  type BuildOptions,
  type ResolvedOptions,
  plantingName
} from './common';
import { formatInches } from './size';
import { familyCareTips, type CareTip, type FamilyCareTips } from './careTips';
import { CARE_SECTION, filterSprayAdviceItems, growerFacingText } from '$lib/journal/photoHelp';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';

const MAX_PLANTINGS = 6;

function familyLabel(family: string, opts: ResolvedOptions): string {
  if ((CROP_FAMILIES as readonly string[]).includes(family))
    return opts.tr(`cards.family.${family}` as MessageKey);
  const s = family.replace(/[-_.]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : opts.tr('cards.care.crop');
}

function careTaskLine(t: SnapshotCareTask): string {
  const title = t.title.trim();
  const body = t.body?.trim();
  if (!body) return title;
  return /[.!?]$/.test(title) ? `${title} ${body}` : `${title}. ${body}`;
}

/** Water, feed, stake and prune, harvest cues, common problems and notes
 *  for one crop. Plugin data wins; family tips fill the gaps as `fallback`.
 *  Plugin text never shows spray advice or notes meant for plugin authors. */
export function careGuideSections(
  plugin: SnapshotCropPlugin,
  sprayTerms?: readonly string[],
  locale?: string | null
): {
  sections: CardSection[];
  tips: FamilyCareTips | null;
} {
  const CARE_SECTION = {
    water: t(locale, 'cards.care.water'),
    feed: t(locale, 'cards.care.feed'),
    prune: t(locale, 'cards.care.prune'),
    harvest: t(locale, 'cards.section.harvestCues'),
    problems: t(locale, 'cards.care.problems'),
    notes: t(locale, 'cards.notes')
  };
  const family = familyCareTips(plugin.cropFamily, locale);
  let usedTips = false;
  const sections: CardSection[] = [];
  const fromTips = (title: string, tips: readonly CareTip[] | undefined) => {
    if (!tips?.length) return;
    usedTips = true;
    sections.push({ title, items: tips.map((t) => t.text), provenance: 'fallback' });
  };
  fromTips(CARE_SECTION.water, family?.water);
  fromTips(CARE_SECTION.feed, family?.feed);
  const tasks = filterSprayAdviceItems(
    (plugin.careTasks ?? []).map(careTaskLine).filter(Boolean),
    sprayTerms
  );
  if (tasks.length) {
    sections.push({ title: CARE_SECTION.prune, items: tasks, provenance: 'plugin' });
  } else {
    fromTips(CARE_SECTION.prune, family?.prune);
  }
  const cues = filterSprayAdviceItems(
    plugin.harvestIndicators?.filter((s) => s.trim()) ?? [],
    sprayTerms
  );
  if (cues.length) sections.push({ title: CARE_SECTION.harvest, items: cues, provenance: 'plugin' });
  fromTips(CARE_SECTION.problems, family?.problems);
  const notes = plugin.notes ? growerFacingText(plugin.notes, sprayTerms) : '';
  if (notes) {
    sections.push({ title: CARE_SECTION.notes, items: [notes], provenance: 'plugin' });
  }
  return { sections, tips: usedTips ? family : null };
}

export function buildCareGuideCard(
  snapshot: FarmSnapshot,
  cropPluginId: string,
  options: BuildOptions = {}
): CardModel | null {
  const plugin = snapshot.cropPlugins[cropPluginId];
  if (!plugin) return null;
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const guide = plugin.plantingGuide;

  const facts: CardFact[] = [];
  const dtm = plugin.daysToMaturity;
  if (dtm) {
    facts.push({
      label: tr('cards.fact.matures'),
      value: daysText(dtm.min, dtm.max, opts),
      provenance: 'plugin'
    });
  }
  if (guide?.seedDepthIn) {
    facts.push({
      label: tr('cards.fact.seedDepth'),
      value: formatInches(guide.seedDepthIn, opts.prefs),
      provenance: 'plugin'
    });
  }
  if (guide?.inRowSpacingIn) {
    facts.push({
      label: tr('cards.fact.spacing'),
      value: formatInches(guide.inRowSpacingIn, opts.prefs),
      provenance: 'plugin'
    });
  }
  const rows = guide?.rowSpacingIn ?? plugin.defaultRowSpacingInches;
  if (rows) {
    facts.push({
      label: tr('cards.fact.rowSpacing'),
      value: formatInches(rows, opts.prefs),
      provenance: 'plugin'
    });
  }
  if (typeof guide?.soilTempMinF === 'number') {
    facts.push({
      label: tr('cards.fact.soilTemp'),
      value: tr('cards.fact.orWarmer', {
        temp: formatQuantity(guide.soilTempMinF, 'temperature', opts.prefs)
      }),
      provenance: 'plugin'
    });
  }
  if (plugin.preHarvestIntervalDays && plugin.preHarvestIntervalDays > 0) {
    facts.push({
      label: 'Wait after spraying',
      value: `${plugin.preHarvestIntervalDays} ${plugin.preHarvestIntervalDays === 1 ? 'day' : 'days'} before picking`,
      provenance: 'plugin'
    });
  }

  const { sections, tips } = careGuideSections(plugin, snapshot.sprayTerms, loc);

  const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
  const growing = snapshot.plantings
    .filter((p) => p.cropPluginId === cropPluginId && p.status !== 'harvested')
    .map((p) => {
      const b = blocks.get(p.blockId);
      const name = plantingName(p, loc);
      return b ? `${name} · ${blockDisplayName(b, loc)}` : name;
    });
  if (growing.length) {
    sections.push({
      title: tr('cards.care.onYourFarm'),
      items:
        growing.length > MAX_PLANTINGS
          ? [
              ...growing.slice(0, MAX_PLANTINGS),
              tr('cards.more', { count: growing.length - MAX_PLANTINGS })
            ]
          : growing
    });
  }
  if (!facts.length && !sections.length) {
    sections.push({
      title: tr('cards.notes'),
      items: [tr('cards.care.noGuide')]
    });
  }

  const key = cardKey('careGuide', plugin.pluginId);
  return {
    kind: 'careGuide',
    key,
    kicker: tr('cards.care.kicker', { family: familyLabel(plugin.cropFamily, opts) }),
    title: cropDisplayName(plugin.pluginId, plugin.displayName, loc),
    facts,
    sections,
    asOf: snapshot.generatedAt,
    provenance: [
      { source: 'plugin', detail: `${plugin.pluginId} · v${plugin.version}` },
      ...(tips
        ? [
            {
              source: 'fallback' as const,
              detail: tr('cards.care.generalTips', { label: tips.label })
            }
          ]
        : [])
    ],
    href: cardHref('careGuide', key)
  };
}

export function buildCareGuideCards(
  snapshot: FarmSnapshot,
  options: BuildOptions = {}
): CardModel[] {
  return Object.keys(snapshot.cropPlugins)
    .sort()
    .map((id) => buildCareGuideCard(snapshot, id, options))
    .filter((c): c is CardModel => c !== null);
}

export const CARE_LINK_LABEL = 'How to care for it';

export function careLinkLabel(locale?: string | null): string {
  return t(locale, 'cards.care.link');
}
const MAX_AREA_CARE_LINKS = 4;

export function careGuideHref(pluginId: string): string {
  return cardHref('careGuide', cardKey('careGuide', pluginId));
}

/** Crop plugins a card's "How to care for it" covers: the planting's crop,
 *  or every crop growing or planned in a garden or greenhouse Area. */
export function careGuidePluginIds(snapshot: FarmSnapshot, cardKeyValue: string): string[] {
  const parsed = parseCardKey(cardKeyValue);
  if (!parsed) return [];
  if (parsed.kind === 'planting') {
    const p = snapshot.plantings.find((x) => x.id === parsed.id);
    return p && snapshot.cropPlugins[p.cropPluginId] ? [p.cropPluginId] : [];
  }
  if (parsed.kind !== 'area') return [];
  const area = snapshot.areas.find((a) => a.id === parsed.id);
  if (!area || !isDesignable(area.kind)) return [];
  const blockIds = new Set(snapshot.blocks.filter((b) => b.areaId === area.id).map((b) => b.id));
  const ids: string[] = [];
  for (const p of snapshot.plantings) {
    if (!blockIds.has(p.blockId) || p.status === 'harvested') continue;
    if (!snapshot.cropPlugins[p.cropPluginId] || ids.includes(p.cropPluginId)) continue;
    ids.push(p.cropPluginId);
  }
  return ids;
}

export function areaCareLinks(
  snapshot: FarmSnapshot,
  areaId: string,
  locale?: string | null
): CardAction[] {
  return careGuidePluginIds(snapshot, cardKey('area', areaId))
    .slice(0, MAX_AREA_CARE_LINKS)
    .map((id) => ({
      label: t(locale, 'cards.care.linkFor', {
        name: cropDisplayName(id, snapshot.cropPlugins[id].displayName, locale)
      }),
      href: careGuideHref(id)
    }));
}
