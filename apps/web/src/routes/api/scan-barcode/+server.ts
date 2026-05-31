import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getStockItemByBarcode, getStockItemByPluginId } from '$lib/db/stock';
import {
  AnthropicOverloadedError,
  claudeTextLookup,
  matchCropPlugins,
  type ScanResult
} from '$lib/server/scanResult';
import { findTaxonomyTermByName, inventoryDomain } from '$lib/db/taxonomy';

const requestSchema = z.object({ barcode: z.string().min(1).max(100) });

const OFF_CATEGORY_MAP: Array<[RegExp, ScanResult['category']]> = [
  [/seed|garden|plant/i, 'seed'],
  [/herbicide|weedkiller|weed.control/i, 'herbicide'],
  [/insecticide|pesticide|pest.control/i, 'insecticide'],
  [/fungicide/i, 'fungicide'],
  [/fertiliz|fertiliser|npk|nitrogen/i, 'fertilizer'],
  [/adjuvant|surfactant/i, 'adjuvant'],
  [/fuel|gasoline|diesel/i, 'fuel']
];

async function tryOpenFoodFacts(barcode: string) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`,
      { headers: { 'User-Agent': 'CropCard/1.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 1 || !data.product) return {};
    const name: string | undefined =
      data.product.product_name_en || data.product.product_name || undefined;
    const tags: string[] = [
      ...(data.product.categories_tags ?? []),
      ...(data.product.labels_tags ?? [])
    ];
    const joined = tags.join(' ');
    let category: ScanResult['category'] | undefined;
    for (const [re, cat] of OFF_CATEGORY_MAP) {
      if (re.test(joined)) {
        category = cat;
        break;
      }
    }
    return { name, category };
  } catch {
    return {};
  }
}

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, 'invalid request');
  const { barcode } = parsed.data;

  const existing = getStockItemByBarcode(barcode);
  if (existing) {
    return json({
      existingStockItemId: existing.id,
      category: existing.category,
      found: true,
      barcode,
      source: 'none'
    } satisfies ScanResult);
  }

  const off = await tryOpenFoodFacts(barcode);
  let result: Partial<ScanResult> = {};

  if (off.name && off.category) {
    result = {
      found: true,
      displayName: off.name,
      category: off.category,
      source: 'openfoodfacts',
      guessed: []
    };
  } else {
    try {
      result = await claudeTextLookup(barcode, off.name);
    } catch (e) {
      if (e instanceof AnthropicOverloadedError) {
        return json(
          {
            found: false,
            source: 'none',
            message: e.message,
            retryable: true,
            barcode
          } satisfies ScanResult & { message: string; retryable: boolean },
          { status: 503 }
        );
      }
      throw e;
    }
    result.source = result.found ? 'claude' : 'none';
  }

  if (result.found && result.category === 'seed' && result.displayName) {
    result.cropPluginMatches = await matchCropPlugins(result.displayName);
  }

  // If a high-confidence catalog match resolves to an existing inventory
  // item, short-circuit so the operator can add stock to it instead of
  // creating a duplicate SKU.
  const topMatch = result.cropPluginMatches?.[0];
  if (result.found && topMatch && topMatch.score >= 0.75) {
    const existingByPlugin = getStockItemByPluginId(topMatch.pluginId);
    if (existingByPlugin) {
      result.existingStockItemId = existingByPlugin.id;
    }
  }

  if (result.found && result.category && result.suggestedType?.name) {
    const match = findTaxonomyTermByName(
      inventoryDomain(result.category),
      result.suggestedType.name
    );
    result.suggestedType = match
      ? { matchedTypeId: match.id, name: match.name, isNew: false }
      : { name: result.suggestedType.name, isNew: true };
  }

  return json({ found: false, source: 'none', ...result, barcode } satisfies ScanResult);
}
