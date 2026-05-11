/**
 * AI-assisted stock metadata refresh (Phase 17 follow-up).
 *
 * Fills in attributes the operator never entered and the initial label
 * scan didn't capture — most importantly the per-variety values the
 * calendar engine wants but family-defaults can't authoritatively
 * provide (e.g., `matureHeightFt`, accurate DTM ranges, soil-temp
 * minimums, NPK ratios on fertilizers).
 *
 * Uses Claude Sonnet 4.6 with the Anthropic-managed `web_search` tool so
 * answers come from real seed-catalog / label sources rather than model
 * recall. Every refreshed field carries a `sourceUrl` citation; the UI
 * surfaces them next to the field for operator review before persisting.
 *
 * Per-item refresh — the prompt structure rewards focused lookup over
 * batch summarization, and limits Anthropic web-search cost (each call
 * is bounded at `max_uses: 4` searches).
 */

import Anthropic from '@anthropic-ai/sdk';
import { selectModel, estimateUsd, type AiResultMeta } from './aiPlanning';
import { getApiKey } from './scanResult';

const MAX_OUTPUT_TOKENS = 1500;
const MAX_WEB_SEARCHES = 4;

export interface StockRefreshInput {
  itemId: string;
  displayName: string;
  category: string;
  /** Hint to Claude — pluginId / cropFamily it's already linked to. */
  pluginId?: string;
  cropFamily?: string;
  /** Existing metadata; Claude is told NOT to overwrite values that look
   *  authoritative. */
  existingSeedMeta?: Record<string, unknown>;
  existingActiveIngredients?: unknown[];
  existingFormulation?: Record<string, unknown>;
}

export interface RefreshedField<T = unknown> {
  value: T;
  sourceUrl?: string;
  /** Page title from the cited source — surfaced as link text. */
  sourceTitle?: string;
}

export interface StockRefreshResult {
  itemId: string;
  /** True when web_search returned at least one citation that informed
   *  the answer. False/absent fields are not persisted by the caller. */
  hasCitations: boolean;
  /** Free-form notes Claude added (e.g., "Three sources agree on
   *  90-95 day DTM; Johnny's lists 85"). UI shows on hover. */
  notes?: string;

  // Seed-only fields
  daysToMaturity?: RefreshedField<number>;
  plantingTempMinF?: RefreshedField<number>;
  spacingInches?: RefreshedField<number>;
  depthInches?: RefreshedField<number>;
  sunRequirement?: RefreshedField<'full-sun' | 'partial-shade' | 'full-shade'>;
  seedsPerPacket?: RefreshedField<number>;
  matureHeightFt?: RefreshedField<number>;

  // Chem-only fields (herbicide / insecticide / fungicide)
  activeIngredients?: RefreshedField<
    Array<{
      name: string;
      concentrationPct?: number;
      chemistryClass?: string;
      iracGroup?: string;
      fracCode?: string;
    }>
  >;

  // Fertilizer-only fields
  npk?: RefreshedField<{ n: number; p: number; k: number }>;
  formulationType?: RefreshedField<string>;
  productClass?: RefreshedField<'synthetic' | 'organic' | 'biocontrol'>;

  /** All citations the model used, in the order it consulted them. */
  citations?: Array<{ url: string; title?: string }>;
}

export interface StockRefreshResponse {
  result: StockRefreshResult | null;
  meta: AiResultMeta & { fallback?: 'no-api-key' | 'upstream-error' | 'no-citations' };
}

/** Public entry — POST /api/stock/[id]/refresh-ai hits this. */
export async function refreshStockItem(input: StockRefreshInput): Promise<StockRefreshResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      result: null,
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'no-api-key'
      }
    };
  }

  const choice = selectModel('rationale'); // Sonnet — accurate extraction
  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt(input);

  try {
    const msg = await client.messages.create({
      model: choice.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [
        // Anthropic-managed web search tool. Charged per use; capped here.
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: MAX_WEB_SEARCHES
        } as never
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
    });

    const usage = msg.usage as {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
    const meta: AiResultMeta = {
      model: choice.model,
      inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      usdEstimate: 0
    };
    meta.usdEstimate = estimateUsd(meta, choice);

    // Claude's text block carries the structured JSON; web_search citations
    // are attached as `citations[]` on the text block when web_search ran.
    const textBlocks = msg.content.filter((c) => c.type === 'text');
    const lastText = textBlocks[textBlocks.length - 1];
    const text = lastText?.type === 'text' ? lastText.text : '';
    const citations = collectCitations(msg.content);

    if (citations.length === 0) {
      return {
        result: { itemId: input.itemId, hasCitations: false },
        meta: { ...meta, fallback: 'no-citations' }
      };
    }

    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      parsed = null;
    }

    const result = validateResponse(parsed, input, citations);
    return { result, meta };
  } catch {
    return {
      result: null,
      meta: {
        model: choice.model,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'upstream-error'
      }
    };
  }
}

function buildPrompt(input: StockRefreshInput): string {
  const lines: string[] = [
    `Refresh canonical metadata for this farm-supply stock item using web search.`,
    ``,
    `Item: ${input.displayName}`,
    `Category: ${input.category}`
  ];
  if (input.cropFamily) lines.push(`Crop family: ${input.cropFamily}`);
  if (input.pluginId) lines.push(`Catalog id: ${input.pluginId}`);

  if (input.existingSeedMeta && Object.keys(input.existingSeedMeta).length > 0) {
    lines.push('', 'Existing seed metadata (do NOT overwrite values that look correct):');
    lines.push(JSON.stringify(input.existingSeedMeta));
  }
  if (input.existingActiveIngredients?.length) {
    lines.push('', 'Existing active ingredients (do NOT overwrite a confirmed value):');
    lines.push(JSON.stringify(input.existingActiveIngredients));
  }
  if (input.existingFormulation && Object.keys(input.existingFormulation).length > 0) {
    lines.push('', 'Existing formulation (do NOT overwrite a confirmed value):');
    lines.push(JSON.stringify(input.existingFormulation));
  }

  lines.push(
    '',
    'Use the web_search tool to find authoritative seed-catalog, vendor, or extension-service pages. Prefer:',
    '  - Seed varieties: Johnny\'s, Baker Creek (Rare Seeds), High Mowing, Botanical Interests, breeder pages, university extension fact sheets.',
    '  - Pesticides: EPA label PDF, manufacturer label page, CDMS / Greenbook label database.',
    '  - Fertilizers: manufacturer guaranteed-analysis label, OMRI listing pages.',
    '',
    'Return ONLY a JSON object with the schema below. Omit any field you cannot back with a citation. NEVER fabricate a number — if no source confirms it, leave the field absent.',
    '',
    'Schema (every present field must be { "value": <data>, "sourceUrl": "...", "sourceTitle": "..." }):',
    '```',
    'For seeds:',
    '  daysToMaturity, plantingTempMinF, spacingInches, depthInches, seedsPerPacket, matureHeightFt: number',
    '  sunRequirement: "full-sun" | "partial-shade" | "full-shade"',
    'For herbicides/insecticides/fungicides:',
    '  activeIngredients: Array<{ name, concentrationPct?, chemistryClass?, iracGroup?, fracCode? }>',
    'For fertilizers:',
    '  npk: { n, p, k }, formulationType: string, productClass: "synthetic"|"organic"|"biocontrol"',
    '```',
    '',
    'Top-level fields (no citation wrapper): "notes" (one short sentence — agreement / disagreement across sources).',
    'Output ONLY the JSON object. No prose, no code fences.'
  );
  return lines.join('\n');
}

interface RawCitation {
  url: string;
  title?: string;
}

function collectCitations(content: Array<unknown>): RawCitation[] {
  const out: RawCitation[] = [];
  const seen = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; citations?: unknown[] };
    if (b.type !== 'text' || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      if (!c || typeof c !== 'object') continue;
      const cit = c as { url?: unknown; title?: unknown };
      if (typeof cit.url !== 'string') continue;
      if (seen.has(cit.url)) continue;
      seen.add(cit.url);
      out.push({
        url: cit.url,
        title: typeof cit.title === 'string' ? cit.title : undefined
      });
    }
  }
  return out;
}

function validateResponse(
  raw: unknown,
  input: StockRefreshInput,
  citations: RawCitation[]
): StockRefreshResult {
  const result: StockRefreshResult = {
    itemId: input.itemId,
    hasCitations: citations.length > 0,
    citations
  };
  if (!raw || typeof raw !== 'object') return result;
  const o = raw as Record<string, unknown>;

  if (typeof o.notes === 'string') result.notes = o.notes.slice(0, 280);

  // Numeric seed fields
  copyNumberField(o, 'daysToMaturity', result, 1, 365);
  copyNumberField(o, 'plantingTempMinF', result, 0, 120);
  copyNumberField(o, 'spacingInches', result, 0.1, 240);
  copyNumberField(o, 'depthInches', result, 0, 12);
  copyNumberField(o, 'seedsPerPacket', result, 1, 100000);
  copyNumberField(o, 'matureHeightFt', result, 0.1, 60);

  // sunRequirement enum
  const sun = o.sunRequirement as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (sun && typeof sun === 'object' && typeof sun.value === 'string') {
    if (['full-sun', 'partial-shade', 'full-shade'].includes(sun.value)) {
      result.sunRequirement = {
        value: sun.value as 'full-sun' | 'partial-shade' | 'full-shade',
        sourceUrl: typeof sun.sourceUrl === 'string' ? sun.sourceUrl : undefined,
        sourceTitle: typeof sun.sourceTitle === 'string' ? sun.sourceTitle : undefined
      };
    }
  }

  // activeIngredients (chem only)
  const ai = o.activeIngredients as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (ai && typeof ai === 'object' && Array.isArray(ai.value)) {
    const cleaned = (ai.value as unknown[])
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        if (typeof r.name !== 'string' || !r.name.trim()) return null;
        const out: Record<string, unknown> = { name: r.name.trim().slice(0, 120) };
        if (typeof r.concentrationPct === 'number' && r.concentrationPct > 0 && r.concentrationPct <= 100) {
          out.concentrationPct = r.concentrationPct;
        }
        if (typeof r.chemistryClass === 'string') out.chemistryClass = r.chemistryClass.trim().slice(0, 64);
        if (typeof r.iracGroup === 'string' && /^[A-Z0-9]{1,4}$/.test(r.iracGroup)) out.iracGroup = r.iracGroup;
        if (typeof r.fracCode === 'string' && /^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/.test(r.fracCode)) out.fracCode = r.fracCode;
        return out;
      })
      .filter((x): x is Record<string, unknown> => x !== null);
    if (cleaned.length > 0) {
      result.activeIngredients = {
        value: cleaned as StockRefreshResult['activeIngredients']['value'],
        sourceUrl: typeof ai.sourceUrl === 'string' ? ai.sourceUrl : undefined,
        sourceTitle: typeof ai.sourceTitle === 'string' ? ai.sourceTitle : undefined
      };
    }
  }

  // Fertilizer fields
  const npk = o.npk as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (npk && typeof npk === 'object' && npk.value && typeof npk.value === 'object') {
    const v = npk.value as { n?: unknown; p?: unknown; k?: unknown };
    if (
      typeof v.n === 'number' && v.n >= 0 && v.n <= 100 &&
      typeof v.p === 'number' && v.p >= 0 && v.p <= 100 &&
      typeof v.k === 'number' && v.k >= 0 && v.k <= 100
    ) {
      result.npk = {
        value: { n: v.n, p: v.p, k: v.k },
        sourceUrl: typeof npk.sourceUrl === 'string' ? npk.sourceUrl : undefined,
        sourceTitle: typeof npk.sourceTitle === 'string' ? npk.sourceTitle : undefined
      };
    }
  }

  const ft = o.formulationType as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (ft && typeof ft === 'object' && typeof ft.value === 'string' && ft.value.trim()) {
    result.formulationType = {
      value: ft.value.trim().slice(0, 32),
      sourceUrl: typeof ft.sourceUrl === 'string' ? ft.sourceUrl : undefined,
      sourceTitle: typeof ft.sourceTitle === 'string' ? ft.sourceTitle : undefined
    };
  }

  const pc = o.productClass as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (pc && typeof pc === 'object' && typeof pc.value === 'string' && ['synthetic', 'organic', 'biocontrol'].includes(pc.value)) {
    result.productClass = {
      value: pc.value as 'synthetic' | 'organic' | 'biocontrol',
      sourceUrl: typeof pc.sourceUrl === 'string' ? pc.sourceUrl : undefined,
      sourceTitle: typeof pc.sourceTitle === 'string' ? pc.sourceTitle : undefined
    };
  }

  return result;
}

function copyNumberField(
  src: Record<string, unknown>,
  key: keyof StockRefreshResult & string,
  dest: StockRefreshResult,
  min: number,
  max: number
): void {
  const raw = src[key] as { value?: unknown; sourceUrl?: unknown; sourceTitle?: unknown } | undefined;
  if (!raw || typeof raw !== 'object') return;
  if (typeof raw.value !== 'number') return;
  if (raw.value < min || raw.value > max) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dest as any)[key] = {
    value: raw.value,
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : undefined,
    sourceTitle: typeof raw.sourceTitle === 'string' ? raw.sourceTitle : undefined
  };
}
