import { formatHours } from '$lib/labour/hours';
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
  daysText,
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
import { seedingFacts } from './seeding';
import { careGuideHref, careLinkLabel } from './careGuide';
import { ymdInZone } from '$lib/prefs';
import { cropDisplayName } from '$lib/i18n/cropName';
import { filterSprayAdviceItems } from '$lib/journal/photoHelp';
import { snapshotSplitFor, splitLine } from './split';

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

function spacingFacts(
  p: SnapshotPlanting,
  plugin: SnapshotCropPlugin | undefined,
  opts: ResolvedOptions
): CardFact[] {
  const { tr } = opts;
  const guide = plugin?.plantingGuide;
  const facts: CardFact[] = [];
  const inRow = p.spacingIn ?? guide?.inRowSpacingIn ?? null;
  if (inRow !== null) {
    facts.push({
      label: tr('cards.fact.spacing'),
      value: formatInches(inRow, opts.prefs),
      provenance: p.spacingIn !== null ? 'manual' : 'plugin'
    });
  }
  const byArea = inRow === null ? guide?.seedingRate : undefined;
  facts.push(...seedingFacts(byArea, opts));
  const rows =
    p.rowSpacingIn ??
    (byArea?.drillRowSpacingIn ? null : (guide?.rowSpacingIn ?? plugin?.defaultRowSpacingInches)) ??
    null;
  if (rows !== null) {
    facts.push({
      label: tr('cards.fact.rowSpacing'),
      value: formatInches(rows, opts.prefs),
      provenance: p.rowSpacingIn !== null ? 'manual' : 'plugin'
    });
  }
  return facts;
}

function countFact(p: SnapshotPlanting, opts: ResolvedOptions): CardFact | null {
  if (p.plantCount !== null && p.plantCount > 0) {
    return {
      label: opts.tr('cards.fact.plants'),
      value: trimNumber(p.plantCount, 0),
      provenance: p.plantCountProvenance ?? undefined
    };
  }
  if (p.quantityPlanted !== null && p.quantityPlanted > 0) {
    const unit = p.quantityUnit ? ` ${p.quantityUnit}` : '';
    return {
      label: opts.tr('cards.fact.quantity'),
      value: `${trimNumber(p.quantityPlanted, 2)}${unit}`,
      provenance: 'manual'
    };
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
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const block = snapshot.blocks.find((b) => b.id === p.blockId);
  const area = block?.areaId ? snapshot.areas.find((a) => a.id === block.areaId) : undefined;
  const plugin = snapshot.cropPlugins[p.cropPluginId];
  const today = ymdInZone(opts.now, opts.prefs.timeZone);

  const facts: CardFact[] = [];
  const src = plantingSource(p);

  if (p.plantingDate) {
    const future = (daysBetweenYmd(today, p.plantingDate) ?? 0) > 0;
    facts.push({
      label: p.status === 'planned' || future ? tr('cards.fact.sow') : tr('cards.fact.planted'),
      value: monthDay(p.plantingDate, loc),
      provenance: src
    });
  } else {
    facts.push({
      label: tr('cards.fact.sow'),
      value: tr('cards.fact.notScheduled'),
      provenance: src
    });
  }

  const window = p.harvestWindow ?? harvestWindow(p.plantingDate, plugin);
  if (p.status === 'harvested' && p.harvestedAt) {
    facts.push({
      label: tr('cards.fact.harvested'),
      value: monthDay(p.harvestedAt, loc),
      provenance: 'data'
    });
  } else if (window) {
    facts.push({
      label: tr('cards.fact.harvest'),
      value: dateRange(window.start, window.end, loc),
      provenance: 'plugin'
    });
  } else if (plugin?.daysToMaturity) {
    const { min, max } = plugin.daysToMaturity;
    facts.push({
      label: tr('cards.fact.matures'),
      value: daysText(min, max, opts),
      provenance: 'plugin'
    });
  }

  if (p.status === 'active' && p.plantingDate) {
    const day = daysBetweenYmd(p.plantingDate, today);
    if (day !== null && day >= 0) {
      facts.push({
        label: tr('cards.fact.day'),
        value: plugin?.daysToMaturity
          ? tr('cards.fact.dayOf', { day, max: plugin.daysToMaturity.max })
          : `${day}`,
        provenance: 'data'
      });
    }
  }

  facts.push(...spacingFacts(p, plugin, opts));
  const count = countFact(p, opts);
  if (count) facts.push(count);
  if (p.minutesLogged && p.minutesLogged > 0) {
    facts.push({
      label: tr('cards.fact.timeLogged'),
      value: formatHours(p.minutesLogged),
      provenance: 'data'
    });
  }

  const phi = plugin?.preHarvestIntervalDays;
  if (phi && phi > 0 && p.status !== 'harvested') {
    facts.push({
      label: 'Wait after spraying',
      value: `${phi} ${phi === 1 ? 'day' : 'days'} before picking`,
      provenance: 'plugin',
      englishOnly: true
    });
  }

  const tasks = sortTasks(snapshot.tasks.filter((t) => t.cropId === p.id));
  const sections: CardSection[] = [];
  const split = snapshotSplitFor(snapshot, p);
  if (split) {
    sections.push({
      title: splitLine(split, tr),
      items: split.others.length
        ? [`${tr('plan.split.alsoIn')}: ${split.others.map((b) => blockDisplayName(b, loc)).join(', ')}`]
        : []
    });
  }
  if (tasks.length > 1) {
    sections.push({
      title: tr('cards.section.comingUp'),
      items: tasks
        .slice(1, 1 + MAX_UPCOMING)
        .map((t) => `${t.title} (${dueLabel(t.scheduledFor, opts.now, opts.prefs)})`)
    });
  }
  const cues = filterSprayAdviceItems(
    plugin?.harvestIndicators?.filter((s) => s.trim()) ?? [],
    snapshot.sprayTerms
  );
  if (cues.length) sections.push({ title: tr('cards.section.harvestCues'), items: cues });

  const provenance: CardProvenance[] = facts
    .filter((f): f is CardFact & { provenance: ProvenanceSource } => !!f.provenance)
    .map((f) =>
      f.provenance === 'plugin' && plugin
        ? { source: 'plugin' as const, detail: `${plugin.pluginId} · v${plugin.version}` }
        : { source: f.provenance }
    );

  const kicker = [
    tr('cards.planting.kicker'),
    block && blockDisplayName(block, loc),
    area && areaDisplayName(area, loc)
  ]
    .filter(Boolean)
    .join(' · ');
  const key = cardKey('planting', p.id);

  return {
    ...(plugin
      ? { links: [{ label: careLinkLabel(loc), href: careGuideHref(plugin.pluginId) }] }
      : {}),
    kind: 'planting',
    key,
    kicker,
    title:
      cropDisplayName(
        p.cropPluginId,
        p.varietyDisplayName.trim() || plugin?.displayName || '',
        opts.prefs.locale
      ) || tr('cards.planting.kicker'),
    facts,
    next: nextAction(tasks, opts, snapshot.plantings),
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
