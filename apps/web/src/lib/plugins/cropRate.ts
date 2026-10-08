/**
 * #737 — a herbicide's label rate for the crops being sprayed. A label that
 * gives rates by crop (Banvel: wheat, barley, corn) carries them in
 * `ratePerAcreByCrop`; the spray mix uses that rate, as a label rate, only
 * when every crop on the block has a row with the same rate. Any other crop
 * mix keeps the plugin's default rate (or none, which reads "Check the
 * label").
 */

import type {
  HerbicidePlugin,
  HerbicideRateByCrop,
  HerbicideStageLimitByCrop
} from '$lib/plugins/schemas';

type CropRateCarrier = Pick<
  HerbicidePlugin,
  'ratePerAcre' | 'rateProvenance' | 'ratePerAcreByCrop' | 'stageLimitByCrop'
>;

export interface CropLabelRate {
  /** The crop rows that matched, one per distinct sprayed crop. */
  rows: HerbicideRateByCrop[];
  amount: number;
  maxAmount?: number;
  unit: HerbicideRateByCrop['unit'];
}

/** The label rate every sprayed crop shares, or null when a crop has no row
 *  or the crops' rows differ. */
export function labelRateForCrops(
  plugin: CropRateCarrier,
  cropPluginIds: readonly string[]
): CropLabelRate | null {
  const table = plugin.ratePerAcreByCrop ?? [];
  const crops = [...new Set(cropPluginIds)];
  if (table.length === 0 || crops.length === 0) return null;
  const rows: HerbicideRateByCrop[] = [];
  for (const id of crops) {
    const row = table.find((r) => r.cropPluginId === id);
    if (!row) return null;
    rows.push(row);
  }
  const [first] = rows;
  const same = rows.every(
    (r) => r.amount === first.amount && r.unit === first.unit && r.maxAmount === first.maxAmount
  );
  if (!same) return null;
  return {
    rows,
    amount: first.amount,
    ...(first.maxAmount !== undefined ? { maxAmount: first.maxAmount } : {}),
    unit: first.unit
  };
}

/** The plugin as the spray mix should see it for these crops: a matching
 *  crop rate replaces the default rate and is marked a label rate. */
export function withCropRate<T extends CropRateCarrier>(
  plugin: T,
  cropPluginIds: readonly string[]
): T {
  const rate = labelRateForCrops(plugin, cropPluginIds);
  if (!rate) return plugin;
  return {
    ...plugin,
    ratePerAcre: { amount: rate.amount, unit: rate.unit },
    rateProvenance: 'label'
  };
}

/** Label stage and seasonal limits for the sprayed crops, in table order. */
export function stageLimitsForCrops(
  plugin: CropRateCarrier,
  cropPluginIds: readonly string[]
): HerbicideStageLimitByCrop[] {
  const crops = new Set(cropPluginIds);
  return (plugin.stageLimitByCrop ?? []).filter((r) => crops.has(r.cropPluginId));
}

/** "2 to 4 fl oz/acre" or "1 pt/acre", in the label's unit. */
export function cropRateText(rate: { amount: number; maxAmount?: number; unit: string }): string {
  const unit = `${rate.unit === 'fl-oz' ? 'fl oz' : rate.unit}/acre`;
  return rate.maxAmount !== undefined && rate.maxAmount !== rate.amount
    ? `${rate.amount} to ${rate.maxAmount} ${unit}`
    : `${rate.amount} ${unit}`;
}

/** One row per crop the label names a rate or a stage limit for, for the
 *  product's detail pages. `crop` is the crop's English name. */
export interface CropRateRow {
  cropPluginId: string;
  crop: string;
  rate: { amount: number; maxAmount?: number; unit: string } | null;
  stageLimits: string[];
}

export function cropRateRows(
  plugin: CropRateCarrier,
  cropName: (cropPluginId: string) => string
): CropRateRow[] {
  const ids: string[] = [];
  for (const r of plugin.ratePerAcreByCrop ?? []) {
    if (!ids.includes(r.cropPluginId)) ids.push(r.cropPluginId);
  }
  for (const r of plugin.stageLimitByCrop ?? []) {
    if (!ids.includes(r.cropPluginId)) ids.push(r.cropPluginId);
  }
  return ids.map((id) => {
    const r = (plugin.ratePerAcreByCrop ?? []).find((x) => x.cropPluginId === id);
    return {
      cropPluginId: id,
      crop: cropName(id),
      rate: r
        ? {
            amount: r.amount,
            ...(r.maxAmount !== undefined ? { maxAmount: r.maxAmount } : {}),
            unit: r.unit
          }
        : null,
      stageLimits: stageLimitsForCrops(plugin, [id]).map((s) => s.limit)
    };
  });
}
