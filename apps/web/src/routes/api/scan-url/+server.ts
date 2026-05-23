import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import {
  AnthropicOverloadedError,
  claudeUrlLookup,
  fetchPageContent,
  matchCropPlugins,
  type ScanResult
} from '$lib/server/scanResult';
import { findTaxonomyTermByName, inventoryDomain } from '$lib/db/taxonomy';
import { getStockItemByPluginId } from '$lib/db/stock';

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048).url()
});

function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  return true;
}

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) error(400, 'invalid request');
  const { url } = parsed.data;
  if (!isPublicHttpUrl(url)) error(400, 'URL must be a public http(s) address');

  let content: Awaited<ReturnType<typeof fetchPageContent>>;
  try {
    content = await fetchPageContent(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load page';
    return json(
      { found: false, source: 'none', message: msg } satisfies ScanResult & { message: string },
      { status: 502 }
    );
  }

  const hasSignal =
    content.bodyText.length >= 40 ||
    content.jsonLd.length > 0 ||
    content.selects.length > 0 ||
    content.tables.length > 0;
  if (!hasSignal) {
    return json(
      {
        found: false,
        source: 'none',
        message: 'Page contained no readable product info — try a different URL.'
      } satisfies ScanResult & { message: string },
      { status: 422 }
    );
  }

  let result: Partial<ScanResult>;
  try {
    result = await claudeUrlLookup(content);
  } catch (e) {
    if (e instanceof AnthropicOverloadedError) {
      return json(
        {
          found: false,
          source: 'none',
          message: e.message,
          retryable: true
        } satisfies ScanResult & { message: string; retryable: boolean },
        { status: 503 }
      );
    }
    const msg = e instanceof Error ? e.message : 'URL read failed';
    error(503, msg);
  }

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

  return json({ found: false, source: 'none', ...result } satisfies ScanResult);
}
