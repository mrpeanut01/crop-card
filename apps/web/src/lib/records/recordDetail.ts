/**
 * #725: the full record page as labelled rows. Ids, rules versions and
 * label fingerprints go to `technical`, shown folded for inspectors.
 * Rates, totals, EPA numbers and REI/PHI clear times stay English
 * (`englishOnly`), the same as on the record card.
 */

import { t, type MessageKey } from '$lib/i18n';
import { formatArea, formatInstant, formatQuantity, type Prefs } from '$lib/prefs';
import { observationLine } from './metricLabel';

export interface DetailRow {
  label: string;
  value: string;
  englishOnly?: boolean;
  /** Long text (notes, saved data) wraps instead of one line. */
  block?: boolean;
}

export interface RecordDetailView {
  rows: DetailRow[];
  technical: DetailRow[];
}

export interface DetailProduct {
  pluginId: string;
  name: string;
  /** null when the label is on file with no number; undefined when the plugin is gone. */
  epaRegistrationNumber?: string | null;
  rate?: { amount: number; unit: string };
}

export interface DetailObservation {
  subject: string;
  metric: string;
  value: number;
}

export interface SprayDetailInput {
  blockLabel: string;
  blockAcres: number | null;
  sprayerLabel: string | null;
  products: DetailProduct[];
  conditions: {
    windMph?: number;
    tempF?: number;
    rainForecastMmNext24h?: number;
    conditionsProvenance?: string;
  } | null;
  customRateOverride?: boolean;
  observation?: DetailObservation | null;
  reEntryClearAt?: number | null;
  preHarvestClearAt?: number | null;
  notes?: string | null;
  rulesVersion?: string | null;
  pluginHashes?: Record<string, string> | null;
}

type P = Pick<Prefs, 'units' | 'locale' | 'timeZone'>;

const L = (prefs: P, key: MessageKey, params?: Record<string, string | number>) =>
  t(prefs.locale, key, params);

function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function rateText(rate: { amount: number; unit: string }): string {
  return `${round2(rate.amount)} ${rate.unit}${rate.unit.includes('/') ? '' : '/A'}`;
}

function productLine(p: DetailProduct, acres: number | null, custom: boolean): string {
  const parts: string[] = [];
  if (p.epaRegistrationNumber !== undefined)
    parts.push(`EPA reg. no. ${p.epaRegistrationNumber ?? 'not on file'}`);
  if (p.rate) {
    parts.push(`${rateText(p.rate)}${custom ? ', custom rate' : ''}`);
    if (acres !== null && acres > 0)
      parts.push(`total ${round2(p.rate.amount * acres)} ${p.rate.unit.split('/')[0].trim()}`);
  } else {
    parts.push('rate not recorded');
  }
  return parts.join(' · ');
}

function notesRow(prefs: P, notes: string | null | undefined): DetailRow[] {
  const text = notes?.trim();
  return text ? [{ label: L(prefs, 'records.field.notes'), value: text, block: true }] : [];
}

function conditionsText(prefs: P, c: NonNullable<SprayDetailInput['conditions']>): string {
  const parts: string[] = [];
  if (typeof c.windMph === 'number')
    parts.push(
      L(prefs, 'records.detail.wind', { value: formatQuantity(c.windMph, 'speed', prefs) })
    );
  if (typeof c.tempF === 'number') parts.push(formatQuantity(c.tempF, 'temperature', prefs));
  if (typeof c.rainForecastMmNext24h === 'number')
    parts.push(
      L(prefs, 'records.detail.rainNext', {
        value: formatQuantity(c.rainForecastMmNext24h / 25.4, 'precip', prefs)
      })
    );
  if (c.conditionsProvenance === 'default') parts.push(L(prefs, 'records.detail.defaultReadings'));
  return parts.join(' · ');
}

export function sprayDetail(input: SprayDetailInput, prefs: P): RecordDetailView {
  const rows: DetailRow[] = [{ label: L(prefs, 'records.field.block'), value: input.blockLabel }];
  rows.push({
    label: L(prefs, 'records.field.areaTreated'),
    value:
      input.blockAcres !== null && input.blockAcres > 0
        ? formatArea(input.blockAcres, prefs)
        : L(prefs, 'records.field.notOnFile')
  });
  if (input.sprayerLabel)
    rows.push({ label: L(prefs, 'records.field.sprayer'), value: input.sprayerLabel });
  for (const p of input.products)
    rows.push({
      label: p.name,
      value: productLine(p, input.blockAcres, input.customRateOverride === true),
      englishOnly: true
    });
  if (input.conditions) {
    const text = conditionsText(prefs, input.conditions);
    if (text) rows.push({ label: L(prefs, 'records.field.conditions'), value: text });
  }
  if (input.observation)
    rows.push({
      label: L(prefs, 'records.field.scouting'),
      value: observationLine(
        input.observation.subject,
        input.observation.metric,
        input.observation.value,
        null,
        prefs.locale
      )
    });
  if (input.reEntryClearAt)
    rows.push({
      label: 'Re-entry clear',
      value: formatInstant(input.reEntryClearAt, prefs, 'datetime'),
      englishOnly: true
    });
  if (input.preHarvestClearAt)
    rows.push({
      label: 'Harvest clear',
      value: formatInstant(input.preHarvestClearAt, prefs, 'date'),
      englishOnly: true
    });
  rows.push(...notesRow(prefs, input.notes));

  const technical: DetailRow[] = [];
  if (input.rulesVersion)
    technical.push({ label: L(prefs, 'records.field.rulesVersion'), value: input.rulesVersion });
  for (const p of input.products)
    technical.push({ label: L(prefs, 'records.field.productId'), value: p.pluginId });
  for (const [id, hash] of Object.entries(input.pluginHashes ?? {}))
    technical.push({ label: L(prefs, 'records.field.labelHash', { id }), value: hash });
  return { rows, technical };
}

export function scoutDetail(
  input: {
    blockLabel: string;
    pest: string;
    metric: string;
    value: number;
    notes?: string | null;
  },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [{ label: L(prefs, 'records.field.block'), value: input.blockLabel }];
  if (input.metric !== 'note') {
    rows.push({
      label: L(prefs, 'records.field.observation'),
      value: observationLine(input.pest, input.metric, input.value, null, prefs.locale)
    });
  } else if (input.pest.trim() && input.pest !== 'note') {
    rows.push({ label: L(prefs, 'records.field.pest'), value: input.pest.trim() });
  }
  rows.push(...notesRow(prefs, input.notes));
  return { rows, technical: [] };
}

export function harvestDetail(
  input: {
    blockLabel: string;
    cropLabel: string;
    cropPluginId: string;
    quantity?: string | null;
    lotNumber?: string | null;
    moisturePct?: number | null;
    detailLines?: string[];
  },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [
    { label: L(prefs, 'records.field.block'), value: input.blockLabel },
    { label: L(prefs, 'records.field.crop'), value: input.cropLabel },
    {
      label: L(prefs, 'records.field.quantity'),
      value: input.quantity?.trim() || L(prefs, 'records.field.notRecorded')
    }
  ];
  if (input.lotNumber?.trim())
    rows.push({ label: L(prefs, 'records.field.lot'), value: input.lotNumber.trim() });
  if (typeof input.moisturePct === 'number')
    rows.push({ label: L(prefs, 'records.field.moisture'), value: `${input.moisturePct}%` });
  if (input.detailLines?.length)
    rows.push({ label: L(prefs, 'records.field.readings'), value: input.detailLines.join(' · ') });
  return {
    rows,
    technical: [{ label: L(prefs, 'records.field.cropId'), value: input.cropPluginId }]
  };
}

export function hayDetail(
  input: {
    blockLabel: string;
    cropLabel: string;
    cropPluginId: string;
    cuttingNumber: number;
    statusLabel: string;
    baleType?: string | null;
    balesQuantity?: number | null;
    baleMoisturePct?: number | null;
    rulesVersion?: string | null;
    notes?: string | null;
  },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [
    { label: L(prefs, 'records.field.block'), value: input.blockLabel },
    { label: L(prefs, 'records.field.crop'), value: input.cropLabel },
    { label: L(prefs, 'records.field.cutting'), value: String(input.cuttingNumber) },
    { label: L(prefs, 'records.field.status'), value: input.statusLabel }
  ];
  if (input.baleType || typeof input.balesQuantity === 'number')
    rows.push({
      label: L(prefs, 'records.field.bales'),
      value: [input.balesQuantity, input.baleType].filter((v) => v != null && v !== '').join(' ')
    });
  if (typeof input.baleMoisturePct === 'number')
    rows.push({
      label: L(prefs, 'records.field.baleMoisture'),
      value: `${input.baleMoisturePct}%`
    });
  rows.push(...notesRow(prefs, input.notes));
  const technical: DetailRow[] = [];
  if (input.rulesVersion)
    technical.push({ label: L(prefs, 'records.field.rulesVersion'), value: input.rulesVersion });
  technical.push({ label: L(prefs, 'records.field.cropId'), value: input.cropPluginId });
  return { rows, technical };
}

function nutrientValue(lbPerAcre: number | null, prefs: P): string {
  return lbPerAcre === null
    ? L(prefs, 'records.detail.nutrientNotKnown')
    : formatQuantity(lbPerAcre, 'weightPerArea', prefs);
}

export function fertilityDetail(
  input: {
    blockLabel: string;
    source: string;
    ratePerAcre: number;
    rateUnit: string;
    nLbPerAcre: number | null;
    pLbPerAcre: number | null;
    kLbPerAcre: number | null;
    notes?: string | null;
  },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [
    { label: L(prefs, 'records.field.block'), value: input.blockLabel },
    { label: L(prefs, 'records.field.source'), value: input.source },
    {
      label: L(prefs, 'records.field.rate'),
      value: `${round2(input.ratePerAcre)} ${input.rateUnit}`
    },
    {
      label: L(prefs, 'records.detail.nDelivered'),
      value: nutrientValue(input.nLbPerAcre, prefs)
    },
    {
      label: L(prefs, 'records.detail.pDelivered'),
      value: nutrientValue(input.pLbPerAcre, prefs)
    },
    {
      label: L(prefs, 'records.detail.kDelivered'),
      value: nutrientValue(input.kLbPerAcre, prefs)
    },
    ...notesRow(prefs, input.notes)
  ];
  return { rows, technical: [] };
}

export function plantingDetail(
  input: {
    blockLabel: string;
    cropLabel: string;
    cropPluginId: string;
    quantityPlanted?: number | null;
    quantityUnit?: string | null;
  },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [
    { label: L(prefs, 'records.field.block'), value: input.blockLabel },
    { label: L(prefs, 'records.field.crop'), value: input.cropLabel }
  ];
  if (typeof input.quantityPlanted === 'number')
    rows.push({
      label: L(prefs, 'records.field.quantityPlanted'),
      value: [round2(input.quantityPlanted), input.quantityUnit].filter(Boolean).join(' ')
    });
  return {
    rows,
    technical: [{ label: L(prefs, 'records.field.cropId'), value: input.cropPluginId }]
  };
}

export function deconDetail(
  input: { equipmentLabel: string; notes?: string | null; payloadJson?: string | null },
  prefs: P
): RecordDetailView {
  const rows: DetailRow[] = [
    { label: L(prefs, 'records.field.equipment'), value: input.equipmentLabel },
    ...notesRow(prefs, input.notes)
  ];
  const technical: DetailRow[] = [];
  if (input.payloadJson?.trim()) {
    let shown = input.payloadJson;
    try {
      shown = JSON.stringify(JSON.parse(input.payloadJson), null, 2);
    } catch {
      /* keep as stored */
    }
    technical.push({ label: L(prefs, 'records.field.savedData'), value: shown, block: true });
  }
  return { rows, technical };
}
