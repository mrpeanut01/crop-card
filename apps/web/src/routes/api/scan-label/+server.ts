import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { claudeVisionLookup, matchCropPlugins, type ScanResult } from '$lib/server/scanResult';
import { runScanAi } from '$lib/server/scanAi';
import { findTaxonomyTermByName, inventoryDomain } from '$lib/db/taxonomy';
import { getStockItemByPluginId } from '$lib/db/stock';

const requestSchema = z.object({
  image: z.string().min(1),
  barcode: z.string().optional()
});

export async function POST(event) {
  const body = await event.request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, 'invalid request');

  const { image, barcode } = parsed.data;

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
