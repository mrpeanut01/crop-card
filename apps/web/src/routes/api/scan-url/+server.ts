import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import {
  claudeUrlLookup,
  fetchPageContent,
  matchCropPlugins,
  type FetchedPageContent,
  type ScanResult
} from '$lib/server/scanResult';
import { findTaxonomyTermByName, inventoryDomain } from '$lib/db/taxonomy';
import { getStockItemByPluginId } from '$lib/db/stock';
import { requireUser } from '$lib/server/auth';
import { runScanAi, ScanInputError } from '$lib/server/scanAi';
import { assertUrlAllowed, POLICY_ERROR_CODES, SafeFetchError } from '$lib/server/safeFetch';

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048).url()
});

const SCAN_URL_TIMEOUT_MS = 45_000;

async function loadPage(url: string): Promise<FetchedPageContent> {
  let content: FetchedPageContent;
  try {
    content = await fetchPageContent(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load page';
    const policy = e instanceof SafeFetchError && POLICY_ERROR_CODES.has(e.code);
    throw new ScanInputError(policy ? 400 : 502, msg);
  }
  const hasSignal =
    content.bodyText.length >= 40 ||
    content.jsonLd.length > 0 ||
    content.selects.length > 0 ||
    content.tables.length > 0;
  if (!hasSignal) {
    throw new ScanInputError(422, 'Page contained no readable product info — try a different URL.');
  }
  return content;
}

export async function POST(event) {
  requireUser(event);
  const body = await event.request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, 'invalid request');
  const { url } = parsed.data;
  try {
    assertUrlAllowed(url);
  } catch (e) {
    error(400, e instanceof Error ? e.message : 'URL must be a public http(s) address');
  }

  const ai = await runScanAi({
    event,
    endpoint: 'scan-url',
    subject: 'page',
    timeoutMs: SCAN_URL_TIMEOUT_MS,
    call: async (onUsage) => claudeUrlLookup(await loadPage(url), onUsage)
  });
  if (!ai.ok) return json(ai.body, { status: ai.status });
  const result = ai.result;

  result.source = 'claude-url';

  if (result.found && result.category === 'seed' && result.displayName) {
    result.cropPluginMatches = await matchCropPlugins(result.displayName);
  }

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
    provenance: 'ai'
  } satisfies ScanResult & { provenance: 'ai' });
}
