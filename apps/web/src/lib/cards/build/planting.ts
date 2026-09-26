import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection,
  type ProvenanceSource
} from '../model';
import type { FarmSnapshot, SnapshotCropPlugin, SnapshotPlanting } from '../snapshot';
import {
  addDaysYmd,
  areaDisplayName,
  blockDisplayName,
  dateRange,
  daysBetweenYmd,
  dueLabel,
  monthDay,
  nextAction,
  resolveOptions,
  sortTasks,
  trimNumber,
  type BuildOptions,
  type ResolvedOptions
} from './common';
import { formatInches } from './size';
import { ymdInZone } from '$lib/prefs';

const MAX_UPCOMING = 3;

export interface HarvestWindow {
  start: string;
  end: string;
}

/** Planting date + the plugin's days-to-maturity range. */
export function harvestWindow(
  plantingDate: string | null,
  plugin: Pick<SnapshotCropPlugin, 'daysToMaturity'> | undefined
): HarvestWindow | null {
  const dtm = plugin?.daysToMaturity;
  if (!plantingDate || !dtm) return null;
  const start = addDaysYmd(plantingDate, Math.min(dtm.min, dtm.max));
  const end = addDaysYmd(plantingDate, Math.max(dtm.min, dtm.max));
  return start && end ? { start, end } : null;
}

function plantingSource(p: SnapshotPlanting): ProvenanceSource {
  return p.sourceProvenance ?? 'manual';
}

function spacingFact(
  p: SnapshotPlanting,
  plugin: SnapshotCropPlugin | undefined,
  opts: ResolvedOptions
): CardFact | null {
  const guide = plugin?.plantingGuide;
  const inRow = p.spacingIn ?? guide?.inRowSpacingIn ?? null;
  const rows = p.rowSpacingIn ?? guide?.rowSpacingIn ?? plugin?.defaultRowSpacingInches ?? null;
  if (inRow === null && rows === null) return null;
  const parts: string[] = [];
  if (inRow !== null) parts.push(formatInches(inRow, opts.prefs));
  if (rows !== null) parts.push(`rows ${formatInches(rows, opts.prefs)}`);
  const manual = p.spacingIn !== null || p.rowSpacingIn !== null;
  return { label: 'Spacing', value: parts.join(' · '), provenance: manual ? 'manual' : 'plugin' };
}

function countFact(p: SnapshotPlanting): CardFact | null {
  if (p.plantCount !== null && p.plantCount > 0) {
    return {
      label: 'Plants',
      value: trimNumber(p.plantCount, 0),
      provenance: p.plantCountProvenance ?? 'manual'
    };
  }
  if (p.quantityPlanted !== null && p.quantityPlanted > 0) {
    const unit = p.quantityUnit ? ` ${p.quantityUnit}` : '';
    return { label: 'Planted', value: `${trimNumber(p.quantityPlanted, 2)}${unit}`, provenance: 'data' };
  }
  return null;
}

export function buildPlantingCard(
  snapshot: FarmSnapshot,
  plantingId: string,
  options: BuildOptions = {}
): CardModel | null {
  const p = snapshot.plantings.find((x) => x.id === plantingId);
  if (!p) return null;
  const opts = resolveOptions(snapshot, options);
  const block = snapshot.blocks.find((b) => b.id === p.blockId);
  const area = block?.areaId ? snapshot.areas.find((a) => a.id === block.areaId) : undefined;
  const plugin = snapshot.cropPlugins[p.cropPluginId];
  const today = ymdInZone(opts.now, opts.prefs.timeZone);

  const facts: CardFact[] = [];
  const src = plantingSource(p);

  if (p.plantingDate) {
    const future = (daysBetweenYmd(today, p.plantingDate) ?? 0) > 0;
    facts.push({
      label: p.status === 'planned' || future ? 'Sow' : 'Planted',
      value: monthDay(p.plantingDate),
      provenance: src
    });
  } else {
    facts.push({ label: 'Sow', value: 'Not scheduled', provenance: src });
  }

  const window = harvestWindow(p.plantingDate, plugin);
  if (p.status === 'harvested' && p.harvestedAt) {
    facts.push({ label: 'Harvested', value: monthDay(p.harvestedAt), provenance: 'data' });
  } else if (window) {
    facts.push({ label: 'Harvest', value: dateRange(window.start, window.end), provenance: 'plugin' });
  } else if (plugin?.daysToMaturity) {
    const { min, max } = plugin.daysToMaturity;
    facts.push({
      label: 'Matures',
      value: min === max ? `${min} days` : `${min}–${max} days`,
      provenance: 'plugin'
    });
  }

  if (p.status === 'active' && p.plantingDate) {
    const day = daysBetweenYmd(p.plantingDate, today);
    if (day !== null && day >= 0) {
      const of = plugin?.daysToMaturity ? ` of ~${plugin.daysToMaturity.max}` : '';
      facts.push({ label: 'Day', value: `${day}${of}`, provenance: 'data' });
    }
  }

  const spacing = spacingFact(p, plugin, opts);
  if (spacing) facts.push(spacing);
  const count = countFact(p);
  if (count) facts.push(count);

  const phi = plugin?.preHarvestIntervalDays;
  if (phi && phi > 0 && p.status !== 'harvested') {
    const cutoff = window ? addDaysYmd(window.start, -phi) : null;
    facts.push({
      label: 'PHI buffer',
      value: cutoff ? `${phi} d · check labels after ${monthDay(cutoff)}` : `${phi} d before harvest`,
      provenance: 'plugin'
    });
  }

  const tasks = sortTasks(snapshot.tasks.filter((t) => t.cropId === p.id));
  const sections: CardSection[] = [];
  if (tasks.length > 1) {
    sections.push({
      title: 'Coming up',
      items: tasks
        .slice(1, 1 + MAX_UPCOMING)
        .map((t) => `${t.title} (${dueLabel(t.scheduledFor, opts.now, opts.prefs)})`)
    });
  }
  const cues = plugin?.harvestIndicators?.filter((s) => s.trim()) ?? [];
  if (cues.length) sections.push({ title: 'Harvest cues', items: cues });

  const provenance: CardProvenance[] = facts
    .filter((f): f is CardFact & { provenance: ProvenanceSource } => !!f.provenance)
    .map((f) =>
      f.provenance === 'plugin' && plugin
        ? { source: 'plugin' as const, detail: `${plugin.pluginId} · v${plugin.version}` }
        : { source: f.provenance }
    );

  const kicker = ['Planting', block && blockDisplayName(block), area && areaDisplayName(area)]
    .filter(Boolean)
    .join(' · ');
  const key = cardKey('planting', p.id);

  return {
    kind: 'planting',
    key,
    kicker,
    title: p.varietyDisplayName.trim() || plugin?.displayName || 'Planting',
    facts,
    next: nextAction(tasks, opts),
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('planting', key)
  };
}

export function buildPlantingCards(
  snapshot: FarmSnapshot,
  options: BuildOptions = {}
): CardModel[] {
  return snapshot.plantings
    .map((p) => buildPlantingCard(snapshot, p.id, options))
    .filter((c): c is CardModel => c !== null);
}
