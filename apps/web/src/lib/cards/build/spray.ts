import { computeRatedDilution, type DilutionLine } from '$lib/dilution/calculator';
import { checkCrossContaminationForClasses } from '$lib/safety/crossContamination';
import { selectDeconProtocol } from '$lib/safety/deconProtocol';
import { TOX_LABEL } from '$lib/safety/pollinatorProtection';
import { RULES_VERSION } from '$lib/safety/version';
import type { SprayerLoadClass } from '$lib/safety/types';
import { formatInstant } from '$lib/prefs';
import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotEquipment, SnapshotSprayProduct } from '../snapshot';
import { resolveOptions, trimNumber, type BuildOptions, type ResolvedOptions } from './common';

export const SPRAY_RECHECK_NOTICE = 'Recheck weather, REI and label before spraying.';
export const SPRAY_REFERENCE_NOTICE = 'Reference, not a clearance';
export const SPRAY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const SPRAY_RULES_MISMATCH_NOTICE =
  'This app and your saved cards use different safety rules. Update the app and refresh your cards before relying on this card.';

/** The decon and dilution sections run in this app's bundle, so a snapshot
 *  built under other rules can't be trusted as one card. */
function rulesMismatch(snapshot: FarmSnapshot): boolean {
  return snapshot.rulesVersion !== RULES_VERSION;
}

function sprayNotices(snapshot: FarmSnapshot): string[] {
  const notices = [SPRAY_RECHECK_NOTICE, SPRAY_REFERENCE_NOTICE];
  if (rulesMismatch(snapshot)) notices.push(SPRAY_RULES_MISMATCH_NOTICE);
  return notices;
}
export const CALIBRATE_FIRST_TITLE = 'Calibrate first';

const SEPARATOR = '~';

const RECORD_HREF: Record<SnapshotSprayProduct['type'], string> = {
  herbicide: '/spray',
  insecticide: '/spray/insecticide',
  fungicide: '/spray/fungicide'
};

export function isCalibratedGpa(gpa: number | null | undefined): gpa is number {
  return typeof gpa === 'number' && Number.isFinite(gpa) && gpa > 0;
}

export function sprayCardId(sprayerId: string, pluginId?: string | null): string {
  return pluginId ? `${sprayerId}${SEPARATOR}${pluginId}` : sprayerId;
}

/** Plugin ids are kebab-case, so the last `~` always splits sprayer from
 *  product even when a sprayer id carries one. */
export function parseSprayCardId(id: string): { sprayerId: string; pluginId: string | null } {
  const i = id.lastIndexOf(SEPARATOR);
  if (i <= 0 || i === id.length - 1) return { sprayerId: id, pluginId: null };
  return { sprayerId: id.slice(0, i), pluginId: id.slice(i + 1) };
}

function sprayers(snapshot: FarmSnapshot): SnapshotEquipment[] {
  return snapshot.equipment.filter((e) => e.type === 'sprayer');
}

function positiveTank(sprayer: SnapshotEquipment): number | null {
  const t = sprayer.tankGal;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
}

function baseCard(
  snapshot: FarmSnapshot,
  sprayer: SnapshotEquipment,
  id: string
): Pick<CardModel, 'kind' | 'key' | 'asOf' | 'rulesVersion' | 'href' | 'staleAfterMs'> {
  const key = cardKey('spray', id);
  return {
    kind: 'spray',
    key,
    asOf: snapshot.generatedAt,
    rulesVersion: RULES_VERSION,
    href: cardHref('spray', key),
    staleAfterMs: rulesMismatch(snapshot) ? 0 : SPRAY_STALE_AFTER_MS
  };
}

function calibrateFirstCard(
  snapshot: FarmSnapshot,
  sprayer: SnapshotEquipment,
  id: string
): CardModel {
  return {
    ...baseCard(snapshot, sprayer, id),
    kicker: `Spray · ${sprayer.label}`,
    title: CALIBRATE_FIRST_TITLE,
    facts: [
      { label: 'Sprayer', value: sprayer.label, provenance: 'manual' },
      { label: 'GPA', value: 'Not calibrated', provenance: 'data' }
    ],
    next: { label: 'Calibrate this sprayer', href: '/calibrate' },
    sections: [
      {
        title: 'Why',
        items: [
          'Mix amounts depend on how many gallons this sprayer puts down per acre.',
          'Calibrate it once and its spray cards will show amounts per tank.'
        ]
      }
    ],
    provenance: [{ source: 'data', detail: 'your sprayer' }],
    notices: sprayNotices(snapshot)
  };
}

function rateText(p: SnapshotSprayProduct): string | null {
  if (!p.ratePerAcre) return null;
  return `${trimNumber(p.ratePerAcre.amount, 2)} ${p.ratePerAcre.unit}/A`;
}

/** The only place a Spray Card turns a label rate into an amount: the
 *  dilution calculator, fed the sprayer's calibrated GPA. */
export function sprayDilution(
  product: SnapshotSprayProduct,
  gpa: number,
  tankGallons: number
): DilutionLine | null {
  if (!product.ratePerAcre || !isCalibratedGpa(gpa)) return null;
  if (!Number.isFinite(tankGallons) || tankGallons <= 0) return null;
  return computeRatedDilution(
    {
      pluginId: product.pluginId,
      displayName: product.displayName,
      ratePerAcre: product.ratePerAcre,
      gpaCalibration: product.gpaCalibration ?? undefined
    },
    tankGallons,
    gpa
  );
}

function dilutionFacts(
  product: SnapshotSprayProduct,
  gpa: number,
  tank: number | null
): CardFact[] {
  if (tank !== null) {
    const line = sprayDilution(product, gpa, tank);
    if (!line) return [];
    return [
      { label: `Per ${trimNumber(tank, 1)}-gal tank`, value: line.display, provenance: 'plugin' },
      {
        label: 'Tank covers',
        value: `${trimNumber(line.acresCovered, 2)} ac`,
        provenance: 'data'
      }
    ];
  }
  const line = sprayDilution(product, gpa, gpa);
  if (!line) return [];
  return [
    {
      label: 'Per acre',
      value: `${line.display} in ${trimNumber(gpa, 1)} gal water`,
      provenance: 'plugin'
    }
  ];
}

function deconSection(product: SnapshotSprayProduct, sprayer: SnapshotEquipment): CardSection {
  const state = sprayer.state;
  const last = (state?.lastChemistryClass ?? undefined) as SprayerLoadClass | undefined;
  const check = checkCrossContaminationForClasses(product.loadClasses as SprayerLoadClass[], {
    id: sprayer.id,
    lastChemistryClass: last,
    lastSprayedAt: state?.lastUsedAt ?? undefined,
    lastDeconAt: state?.lastDeconAt ?? undefined
  });
  if (check.requiresDecon) {
    const protocol = selectDeconProtocol(last);
    return {
      title: `Decon first: ${protocol.label}`,
      items: [`Last load was ${last}.`, ...protocol.steps]
    };
  }
  const after = selectDeconProtocol(product.loadClasses[0] as SprayerLoadClass | undefined);
  return {
    title: 'Decon',
    items: [
      last ? `Last load was ${last}; no decon needed first.` : 'Tank is clean on record.',
      `Before a different chemistry: ${after.label.toLowerCase()}.`
    ]
  };
}

function beforeYouSpray(product: SnapshotSprayProduct): string[] {
  const items = ['Wear the PPE the label lists.'];
  const tox = product.pollinator?.beeToxicity;
  if (tox && tox !== 'relatively-nontoxic') {
    const label = TOX_LABEL[tox as keyof typeof TOX_LABEL] ?? TOX_LABEL.unknown;
    items.push(
      `${label}: check the crop and weeds for open flowers and spray after foragers leave.`
    );
  }
  if (product.pollinator?.bloomRestriction === 'prohibited-during-bloom') {
    items.push('Label bans spraying while the crop or weeds are in bloom.');
  } else if (product.pollinator?.bloomRestriction === 'dusk-to-dawn-only') {
    items.push('Spray only between sunset and sunrise while bees forage.');
  }
  if (product.rainfastHours) {
    items.push(`Needs about ${trimNumber(product.rainfastHours, 1)} h dry after spraying.`);
  }
  return items;
}

function productCard(
  snapshot: FarmSnapshot,
  sprayer: SnapshotEquipment,
  product: SnapshotSprayProduct,
  gpa: number,
  opts: ResolvedOptions
): CardModel {
  const id = sprayCardId(sprayer.id, product.pluginId);
  const tank = positiveTank(sprayer);
  const calibratedOn = sprayer.state?.calibrationDate;

  const facts: CardFact[] = [
    {
      label: 'EPA reg. no.',
      value: product.epaRegistrationNumber ?? 'Not on file, check the label',
      provenance: 'plugin'
    },
    { label: 'Rate', value: rateText(product) ?? 'See label', provenance: 'plugin' },
    {
      label: 'Sprayer',
      value: calibratedOn
        ? `${trimNumber(gpa, 1)} GPA · calibrated ${formatInstant(calibratedOn, opts.prefs, 'month-day')}`
        : `${trimNumber(gpa, 1)} GPA`,
      provenance: 'data'
    },
    ...dilutionFacts(product, gpa, tank),
    {
      label: 'REI',
      value:
        product.reEntryIntervalHours !== null ? `${product.reEntryIntervalHours} h` : 'See label',
      provenance: 'plugin'
    },
    {
      label: 'PHI',
      value:
        product.preHarvestIntervalDays !== null
          ? `${product.preHarvestIntervalDays} d`
          : 'See label',
      provenance: 'plugin'
    }
  ];
  if (product.targets.length) {
    facts.push({ label: 'Target', value: product.targets.join(', '), provenance: 'plugin' });
  }

  const sections: CardSection[] = [
    {
      title: 'Mix order',
      items: product.mixSteps.length
        ? product.mixSteps
        : ['Follow the mixing directions on the label.']
    },
    { title: 'Before you spray', items: beforeYouSpray(product) },
    deconSection(product, sprayer)
  ];

  const provenance: CardProvenance[] = [
    { source: 'plugin', detail: `${product.pluginId} · v${product.version}` },
    { source: 'data', detail: 'your sprayer calibration' }
  ];

  return {
    ...baseCard(snapshot, sprayer, id),
    kicker: `Spray · ${sprayer.label}`,
    title: product.displayName,
    facts,
    next: { label: 'Record this spray', href: RECORD_HREF[product.type] },
    sections,
    provenance: mergeProvenance(provenance),
    notices: sprayNotices(snapshot)
  };
}

export function buildSprayCard(
  snapshot: FarmSnapshot,
  id: string,
  options: BuildOptions = {}
): CardModel | null {
  const { sprayerId, pluginId } = parseSprayCardId(id);
  const sprayer = sprayers(snapshot).find((s) => s.id === sprayerId);
  if (!sprayer) return null;
  const gpa = sprayer.state?.calibratedGpa;
  if (!isCalibratedGpa(gpa)) return calibrateFirstCard(snapshot, sprayer, id);
  if (!pluginId) return null;
  const product = snapshot.sprayProducts?.[pluginId];
  if (!product) return null;
  return productCard(snapshot, sprayer, product, gpa, resolveOptions(snapshot, options));
}

export function buildSprayCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  const opts = resolveOptions(snapshot, options);
  const products = Object.values(snapshot.sprayProducts ?? {}).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
  const out: CardModel[] = [];
  for (const sprayer of sprayers(snapshot)) {
    const gpa = sprayer.state?.calibratedGpa;
    if (!isCalibratedGpa(gpa)) {
      out.push(calibrateFirstCard(snapshot, sprayer, sprayer.id));
      continue;
    }
    for (const p of products) out.push(productCard(snapshot, sprayer, p, gpa, opts));
  }
  return out;
}
