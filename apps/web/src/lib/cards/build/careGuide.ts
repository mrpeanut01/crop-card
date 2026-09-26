import { formatQuantity } from '$lib/prefs';
import { cardHref, cardKey, type CardFact, type CardModel, type CardSection } from '../model';
import type { FarmSnapshot } from '../snapshot';
import { blockDisplayName, resolveOptions, type BuildOptions } from './common';
import { formatInches } from './size';

const MAX_PLANTINGS = 6;

function familyLabel(family: string): string {
  const s = family.replace(/[-_.]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Crop';
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

  const sections: CardSection[] = [];
  const cues = plugin.harvestIndicators?.filter((s) => s.trim()) ?? [];
  if (cues.length) sections.push({ title: 'Harvest cues', items: cues });
  if (plugin.notes?.trim()) sections.push({ title: 'Notes', items: [plugin.notes.trim()] });

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
    provenance: [{ source: 'plugin', detail: `${plugin.pluginId} · v${plugin.version}` }],
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
