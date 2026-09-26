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
import { blockDisplayName, resolveOptions, type BuildOptions } from './common';
import { formatInches } from './size';
import { familyCareTips, type FamilyCareTips } from './careTips';
import { CARE_SECTION } from '$lib/journal/photoHelp';

const MAX_PLANTINGS = 6;

function familyLabel(family: string): string {
  const s = family.replace(/[-_.]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Crop';
}

function careTaskLine(t: SnapshotCareTask): string {
  const title = t.title.trim();
  const body = t.body?.trim();
  if (!body) return title;
  return /[.!?]$/.test(title) ? `${title} ${body}` : `${title}. ${body}`;
}

/** Water, feed, stake and prune, harvest cues, common problems and notes
 *  for one crop. Plugin data wins; family tips fill the gaps as `fallback`. */
export function careGuideSections(plugin: SnapshotCropPlugin): {
  sections: CardSection[];
  tips: FamilyCareTips | null;
} {
  const family = familyCareTips(plugin.cropFamily);
  let usedTips = false;
  const sections: CardSection[] = [];
  const fromTips = (title: string, items: string[] | undefined) => {
    if (!items?.length) return;
    usedTips = true;
    sections.push({ title, items: [...items], provenance: 'fallback' });
  };
  fromTips(CARE_SECTION.water, family?.water);
  fromTips(CARE_SECTION.feed, family?.feed);
  const tasks = (plugin.careTasks ?? []).map(careTaskLine).filter(Boolean);
  if (tasks.length) {
    sections.push({ title: CARE_SECTION.prune, items: tasks, provenance: 'plugin' });
  } else {
    fromTips(CARE_SECTION.prune, family?.prune);
  }
  const cues = plugin.harvestIndicators?.filter((s) => s.trim()) ?? [];
  if (cues.length) sections.push({ title: CARE_SECTION.harvest, items: cues, provenance: 'plugin' });
  fromTips(CARE_SECTION.problems, family?.problems);
  if (plugin.notes?.trim()) {
    sections.push({ title: CARE_SECTION.notes, items: [plugin.notes.trim()], provenance: 'plugin' });
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
  const guide = plugin.plantingGuide;

  const facts: CardFact[] = [];
  const dtm = plugin.daysToMaturity;
  if (dtm) {
    facts.push({
      label: 'Matures',
      value: dtm.min === dtm.max ? `${dtm.min} days` : `${dtm.min}–${dtm.max} days`,
      provenance: 'plugin'
    });
  }
  if (guide?.seedDepthIn) {
    facts.push({
      label: 'Seed depth',
      value: formatInches(guide.seedDepthIn, opts.prefs),
      provenance: 'plugin'
    });
  }
  if (guide?.inRowSpacingIn) {
    facts.push({
      label: 'Spacing',
      value: formatInches(guide.inRowSpacingIn, opts.prefs),
      provenance: 'plugin'
    });
  }
  const rows = guide?.rowSpacingIn ?? plugin.defaultRowSpacingInches;
  if (rows) {
    facts.push({ label: 'Row spacing', value: formatInches(rows, opts.prefs), provenance: 'plugin' });
  }
  if (typeof guide?.soilTempMinF === 'number') {
    facts.push({
      label: 'Soil temp',
      value: `${formatQuantity(guide.soilTempMinF, 'temperature', opts.prefs)} or warmer`,
      provenance: 'plugin'
    });
  }
  if (plugin.preHarvestIntervalDays && plugin.preHarvestIntervalDays > 0) {
    facts.push({
      label: 'PHI buffer',
      value: `${plugin.preHarvestIntervalDays} d`,
      provenance: 'plugin'
    });
  }

  const { sections, tips } = careGuideSections(plugin);

  const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
  const growing = snapshot.plantings
    .filter((p) => p.cropPluginId === cropPluginId && p.status !== 'harvested')
    .map((p) => {
      const b = blocks.get(p.blockId);
      return b ? `${p.varietyDisplayName} · ${blockDisplayName(b)}` : p.varietyDisplayName;
    });
  if (growing.length) {
    sections.push({
      title: 'On your farm',
      items:
        growing.length > MAX_PLANTINGS
          ? [...growing.slice(0, MAX_PLANTINGS), `+${growing.length - MAX_PLANTINGS} more`]
          : growing
    });
  }
  if (!facts.length && !sections.length) {
    sections.push({
      title: 'Notes',
      items: ['This crop has no growing guide yet. Check the seed packet for spacing and depth.']
    });
  }

  const key = cardKey('careGuide', plugin.pluginId);
  return {
    kind: 'careGuide',
    key,
    kicker: `Care guide · ${familyLabel(plugin.cropFamily)}`,
    title: plugin.displayName,
    facts,
    sections,
    asOf: snapshot.generatedAt,
    provenance: [
      { source: 'plugin', detail: `${plugin.pluginId} · v${plugin.version}` },
      ...(tips ? [{ source: 'fallback' as const, detail: `General tips for ${tips.label}` }] : [])
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

export function areaCareLinks(snapshot: FarmSnapshot, areaId: string): CardAction[] {
  return careGuidePluginIds(snapshot, cardKey('area', areaId))
    .slice(0, MAX_AREA_CARE_LINKS)
    .map((id) => ({
      label: `How to care for ${snapshot.cropPlugins[id].displayName}`,
      href: careGuideHref(id)
    }));
}
