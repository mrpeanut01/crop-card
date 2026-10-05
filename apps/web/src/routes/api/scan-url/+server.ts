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
import { t } from '$lib/i18n';

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048).url()
});

const SCAN_URL_TIMEOUT_MS = 45_000;

type PolicyCode = 'invalid-url' | 'bad-scheme' | 'credentials' | 'blocked-address' | 'bad-redirect';

/** The page-load or URL-policy error in the caller's language. English keeps
 *  the underlying message as it was. */
function urlErrorMessage(e: unknown, fallback: string, locale?: string | null): string {
  if (!locale || locale === 'en') return e instanceof Error ? e.message : fallback;
  if (e instanceof SafeFetchError && POLICY_ERROR_CODES.has(e.code)) {
    return t(locale, `scanai.url.${e.code as PolicyCode}`);
  }
  return t(locale, 'scanai.url.loadFailed');
}

async function loadPage(url: string, locale?: string | null): Promise<FetchedPageContent> {
  let content: FetchedPageContent;
  try {
    content = await fetchPageContent(url);
  } catch (e) {
    const msg = urlErrorMessage(e, 'Could not load page', locale);
    const policy = e instanceof SafeFetchError && POLICY_ERROR_CODES.has(e.code);
    throw new ScanInputError(policy ? 400 : 502, msg);
  }
  const hasSignal =
    content.bodyText.length >= 40 ||
    content.jsonLd.length > 0 ||
    content.selects.length > 0 ||
    content.tables.length > 0;
  if (!hasSignal) {
    throw new ScanInputError(422, t(locale, 'scanai.url.noInfo'));
  }
  return content;
}

export async function POST(event) {
  requireUser(event);
  const body = await event.request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, t(event.locals?.locale, 'stockui.api.invalidRequest'));
  const { url } = parsed.data;
  try {
    assertUrlAllowed(url);
  } catch (e) {
    error(400, urlErrorMessage(e, 'URL must be a public http(s) address', event.locals?.locale));
  }

  const ai = await runScanAi({
    event,
    endpoint: 'scan-url',
    subject: 'page',
    timeoutMs: SCAN_URL_TIMEOUT_MS,
    call: async (onUsage) => claudeUrlLookup(await loadPage(url, event.locals?.locale), onUsage)
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
