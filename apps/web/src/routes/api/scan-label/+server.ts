import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import {
  claudeMedLabelLookup,
  claudeVisionLookup,
  matchCropPlugins,
  type ScanResult
} from '$lib/server/scanResult';
import { animalHealthRefs } from '$lib/server/inventoryLibrary';
import { matchHealthPluginByNada } from '$lib/stock/animalStock';
import { runScanAi } from '$lib/server/scanAi';
import { findTaxonomyTermByName, inventoryDomain } from '$lib/db/taxonomy';
import { getStockItemByPluginId } from '$lib/db/stock';

const requestSchema = z.object({
  image: z.string().min(1),
  barcode: z.string().optional(),
  /** Phase 32D: a medicine label, read for its name and NADA only. */
  target: z.literal('animal-health').optional()
});

export async function POST(event) {
  const body = await event.request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, 'invalid request');

  const { image, barcode, target } = parsed.data;

  if (target === 'animal-health') {
    const med = await runScanAi({
      event,
      endpoint: 'scan-label',
      subject: 'label',
      call: (onUsage) => claudeMedLabelLookup(image, onUsage)
    });
    if (!med.ok) return json(med.body, { status: med.status });
    const scan = med.result as { found?: boolean; displayName?: string; nada?: ScanResult['nada'] };
    const suggestion = matchHealthPluginByNada(scan.nada, await animalHealthRefs());
    return json({
      found: !!scan.found,
      source: 'claude-vision',
      ...(scan.displayName ? { displayName: scan.displayName } : {}),
      ...(scan.nada ? { nada: scan.nada } : {}),
      suggestedHealthPlugin: suggestion
        ? { pluginId: suggestion.pluginId, displayName: suggestion.displayName }
        : null,
      provenance: 'ai'
    });
  }

  const ai = await runScanAi({
    event,
    endpoint: 'scan-label',
    subject: 'label',
    call: (onUsage) => claudeVisionLookup(image, barcode, onUsage)
  });
  if (!ai.ok) return json({ ...ai.body, barcode }, { status: ai.status });
  const result = ai.result;

  result.source = 'claude-vision';

  if (result.found && result.category === 'seed' && result.displayName) {
    result.cropPluginMatches = await matchCropPlugins(result.displayName);
  }

  // If a high-confidence catalog match resolves to an existing inventory
  // item, short-circuit: the operator almost certainly wants to add stock to
  // the existing SKU rather than create a duplicate row.
  const topMatch = result.cropPluginMatches?.[0];
  if (result.found && topMatch && topMatch.score >= 0.75) {
    const existing = getStockItemByPluginId(topMatch.pluginId);
    if (existing) {
      result.existingStockItemId = existing.id;
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

  return json({
    found: false,
    source: 'none',
    ...result,
    barcode,
    provenance: 'ai'
  } satisfies ScanResult & { provenance: 'ai' });
}
