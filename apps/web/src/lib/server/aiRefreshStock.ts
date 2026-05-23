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
import { getPlatesCatalog } from '$lib/planterPlate/catalog';
import {
  CLASS_DEFAULT_DIMS_MM,
  inferSeedTypeFromName,
  isLowConfidence,
  matchPlates,
  mmToInternal
} from '$lib/planterPlate/match';
import type { PlateSeedType, PlateShape } from '$lib/planterPlate/types';

const MAX_OUTPUT_TOKENS = 1500;
const MAX_WEB_SEARCHES = 4;

export interface StockRefreshInput {
  itemId: string;
  displayName: string;
  category: string;
  /** Phase 17 follow-up — shorter, marketing-stripped variety name when
   *  available. Used as the primary web_search query to avoid Claude
   *  trying to search noisy SKU strings like
   *  "Bloody Butcher Ornamental Corn — Raw Untreated Non-GMO (1/2 lb)". */
  shortName?: string;
  /** Hint to Claude — pluginId / cropFamily it's already linked to. */
  pluginId?: string;
  cropFamily?: string;
  /** Existing metadata; Claude is told NOT to overwrite values that look
   *  authoritative. */
  existingSeedMeta?: Record<string, unknown>;
  existingActiveIngredients?: unknown[];
  existingFormulation?: Record<string, unknown>;
  /** Taxonomy "Type" name on the stock item (e.g., "Corn", "Sorghum"). Used
   *  on the server-only side to map to the planter-plate catalog's seedType
   *  enum and run the engine after Claude returns seed dimensions. Not sent
   *  to Claude. */
  seedTypeName?: string;
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
  /** Approximate kernel dimensions in mm, from typical seed-grade charts.
   *  Used to drive the planter-plate selector. */
  seedDimensionsMm?: RefreshedField<{ L: number; D: number; T: number }>;
  /** Kernel shape — only meaningful for Corn/Soybean. */
  seedShape?: RefreshedField<PlateShape>;
  /** Deterministic plate pick from the matching engine using
   *  seedDimensionsMm + seedShape + seedType (no AI hallucination — the
   *  catalog lookup is purely computed server-side). `confidenceReason` is
   *  populated when `lowConfidence` is true so the UI can explain why. */
  planterPlateConfig?: RefreshedField<{
    plateNumber: string;
    series: 'B' | 'C';
    brand: string;
    cells: number;
    color: string;
    dimensions: string;
    L: number;
    D: number;
    T: number;
    shape: PlateShape;
    seedType: PlateSeedType;
    gradeSize: string;
    lowConfidence: boolean;
    confidenceReason: string | null;
    source: 'ai-suggested';
  }>;

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

  /** Human-readable explanation of what the plate auto-picker did. Always
   *  set for seed items so the UI can show *something* in the review panel
   *  even when no plate could be picked. Distinct from `notes` (which is
   *  AI-authored) and from `planterPlateConfig` (which is only present on
   *  successful matches). */
  planterPlatePickNote?: string;
}

export interface StockRefreshResponse {
  result: StockRefreshResult | null;
  meta: AiResultMeta & {
    fallback?: 'no-api-key' | 'upstream-error' | 'no-citations';
    /** Phase 17 follow-up — when fallback is 'upstream-error', this carries
     *  the actual exception message from the Anthropic SDK so the UI can
     *  surface it (e.g. "web_search not enabled on this account"). */
    errorMessage?: string;
  };
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
      // Anthropic-managed web search tool. Charged per use; capped here.
      // SDK 0.95.x exports WebSearchTool20250305 with this exact shape.
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: MAX_WEB_SEARCHES
        }
      ],
      // Phase 17 follow-up — force web_search use. Without this, Claude can
      // (and did) skip the tool and answer from training data, leaving the
      // response with zero citations and us with no way to verify the
      // value. `tool_choice: { type: 'any' }` requires SOME tool call;
      // since web_search is the only tool available, that means at least
      // one search runs.
      tool_choice: { type: 'any' },
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
      console.warn(
        `[aiRefreshStock] item=${input.itemId} model=${choice.model} returned no citations; raw text (first 400): ${text.slice(0, 400)}`
      );
      return {
        result: { itemId: input.itemId, hasCitations: false },
        meta: { ...meta, fallback: 'no-citations' }
      };
    }

    const parsed = extractJsonObject(text);
    const result = validateResponse(parsed, input, citations);

    // Phase 17 follow-up — diagnose silent "0 fields with citations" cases.
    // If web_search ran + returned URLs but no field values made it through
    // validation, log the raw response so an operator can see exactly what
    // Claude said and tune the prompt or accept that the variety has no
    // extractable spec on the web.
    const valueFieldCount = Object.keys(result).filter(
      (k) => !['itemId', 'hasCitations', 'notes', 'citations'].includes(k)
    ).length;
    if (valueFieldCount === 0) {
      console.warn(
        `[aiRefreshStock] item=${input.itemId} got ${citations.length} citation(s) but zero usable fields. raw text (first 600): ${text.slice(0, 600)}`
      );
    }

    return { result, meta };
  } catch (err) {
    // Phase 17 follow-up — surface the actual Anthropic error so the UI can
    // explain the failure (e.g. web_search not enabled, model not allowed,
    // 429, etc). Server-side console.error gives operators a stack to
    // correlate with dev container logs.
    const errorMessage = formatAnthropicError(err);
    console.error(
      `[aiRefreshStock] item=${input.itemId} model=${choice.model} failed: ${errorMessage}`,
      err
    );
    return {
      result: null,
      meta: {
        model: choice.model,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'upstream-error',
        errorMessage
      }
    };
  }
}

/** Extract the first balanced JSON object from a text response.
 *
 *  Claude sometimes returns JSON wrapped in code fences, prefixed with
 *  prose, or trailed by markdown commentary — especially when the
 *  `web_search` tool has fired. A naive `JSON.parse(stripped)` rejects
 *  all of those. This helper:
 *    1. Strips code fences (```json ... ```).
 *    2. Finds the first '{' and walks forward tracking brace depth
 *       (respecting string literals + escapes) until the matching '}'.
 *    3. Parses just that slice.
 *  Returns null when no balanced object can be found. */
function extractJsonObject(raw: string): unknown {
  if (!raw) return null;
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Fast path — well-formed JSON.
  try {
    return JSON.parse(stripped);
  } catch {
    /* fall through to scan */
  }

  const start = stripped.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Best-effort marketing-fluff removal for displayName when no shortName
 *  is available. Drops common packaging tokens, treatment labels, pack
 *  sizes, and supplier suffixes so the resulting string is something a
 *  search engine will actually match against. */
function stripMarketingNoise(s: string): string {
  return s
    .replace(/—.*$/, '') // anything after an em-dash (usually packaging)
    .replace(/\([^)]*\)/g, '') // parenthetical (1/2 lb), (Treated), etc.
    .replace(
      /\b(film coated|film-coated|raw|untreated|treated|non[- ]?gmo|organic|heirloom|hybrid|f1|seed packet)\b/gi,
      ''
    )
    .replace(/\b\d+\/\d+\s*(lb|oz|g|kg)\b/gi, '')
    .replace(/\b\d+\s*(lb|oz|g|kg|seeds|count)\b/gi, '')
    .replace(/\bSKU[\s:]+[A-Z0-9-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the most informative message out of an Anthropic SDK error.
 *  Falls back to `String(err)` for non-SDK exceptions. */
function formatAnthropicError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as {
    status?: number;
    message?: string;
    error?: { error?: { type?: string; message?: string }; message?: string };
  };
  // SDK shape: { status, error: { error: { type, message } } } for HTTP errors.
  const inner = e.error?.error;
  if (inner?.message) {
    const status = e.status ? `[${e.status}] ` : '';
    return `${status}${inner.type ?? 'error'}: ${inner.message}`;
  }
  if (e.error?.message) return `[${e.status ?? '?'}] ${e.error.message}`;
  if (e.message) return e.message;
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return String(err);
  }
}

function buildPrompt(input: StockRefreshInput): string {
  // Phase 17 follow-up — always pick the cleanest searchable name. Long
  // SKU strings ("Bloody Butcher Ornamental Corn — Raw Untreated Non-GMO
  // (1/2 lb)") return zero useful results. Prefer the short name when
  // present; otherwise strip common marketing tokens from displayName.
  const searchName = input.shortName?.trim() || stripMarketingNoise(input.displayName);

  const lines: string[] = [
    `You MUST use the web_search tool. Refresh canonical metadata for this farm-supply stock item.`,
    ``,
    `## Item`,
    `- Variety/Product (use this for searches): ${searchName}`,
    `- Full label name (do NOT search this verbatim — it has marketing fluff): ${input.displayName}`,
    `- Category: ${input.category}`
  ];
  if (input.cropFamily) lines.push(`- Crop family: ${input.cropFamily}`);
  if (input.pluginId) lines.push(`- Catalog id: ${input.pluginId}`);
  if (input.seedTypeName) lines.push(`- Seed type (taxonomy): ${input.seedTypeName}`);

  if (input.existingSeedMeta && Object.keys(input.existingSeedMeta).length > 0) {
    lines.push('', '## Existing seed metadata (do NOT overwrite values that look correct):');
    lines.push(JSON.stringify(input.existingSeedMeta));
  }
  if (input.existingActiveIngredients?.length) {
    lines.push('', '## Existing active ingredients (do NOT overwrite a confirmed value):');
    lines.push(JSON.stringify(input.existingActiveIngredients));
  }
  if (input.existingFormulation && Object.keys(input.existingFormulation).length > 0) {
    lines.push('', '## Existing formulation (do NOT overwrite a confirmed value):');
    lines.push(JSON.stringify(input.existingFormulation));
  }

  lines.push(
    '',
    '## Search strategy',
    `Run 2-4 web_search queries using the variety name (${searchName}), NOT the full label name. Examples of good queries for a corn variety:`,
    `  - "${searchName} days to maturity"`,
    `  - "${searchName} plant height seed catalog"`,
    `  - "${searchName} seed spacing planting"`,
    '',
    'For Corn / Sorghum / Soybean / Sunflower seed items, ALSO run a query for kernel size / seed dimensions:',
    `  - "${searchName} kernel size mm" or "${searchName} seed dimensions"`,
    `  - For corn: "${searchName} grade size flat round" — most dent/flour corn is "MR Flat" or "LR Round"; popcorn is small round; sweet corn is medium flat`,
    `  - Acceptable fallback sources for kernel size: USDA / land-grant university grain-grade charts (e.g., "corn flat dent kernel dimensions mm"), Lincoln Ag plate-selection charts, seed-conditioning equipment vendors. Use these even if they describe the seed CLASS rather than the specific variety — note in seedDimensionsMm.sourceTitle that it's a class-level estimate.`,
    '',
    'Authoritative sources, in priority order:',
    "  - Seeds: Johnny's Selected Seeds, Baker Creek (Rareseeds.com), High Mowing, Botanical Interests, Sow True Seed, Seed Savers Exchange, university extension fact sheets",
    '  - Pesticides: EPA label PDF, manufacturer label page, CDMS / Greenbook label database',
    '  - Fertilizers: manufacturer guaranteed-analysis label, OMRI listing pages',
    '',
    '## Output',
    'Return ONLY a JSON object with the schema below. Omit any field you cannot back with a citation. NEVER fabricate a number — if no source confirms it, leave the field absent.',
    '',
    'Schema (every present field must be { "value": <data>, "sourceUrl": "...", "sourceTitle": "..." }):',
    '```',
    'For seeds:',
    '  daysToMaturity, plantingTempMinF, spacingInches, depthInches, seedsPerPacket, matureHeightFt: number',
    '  sunRequirement: "full-sun" | "partial-shade" | "full-shade"',
    '  seedDimensionsMm: { L: <length mm>, D: <depth/width mm>, T: <thickness mm> }',
    '     IMPORTANT: For Corn / Sorghum / Soybean / Sunflower items, ALWAYS attempt to include this. Class-level estimates from grain-grade charts are acceptable when no variety-specific source exists — say so in sourceTitle (e.g., "Class-level estimate: medium flat dent corn"). Use the exact key names L, D, T — do NOT use length/width/thickness.',
    '  seedShape: "Round" | "Flat" (only relevant for Corn and Soybean; omit for other seed types)',
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

  // Primary path — text blocks with `citations[]` markers Claude attached
  // when it referenced specific search results in its prose.
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

  // Fallback — when Claude returns text without explicit citation markers,
  // pull URLs straight from any `web_search_tool_result` block. Less precise
  // (we don't know which source backed which value) but at least proves
  // the model consulted real pages, and gives the operator something to
  // verify against. Without this fallback, valid responses get rejected
  // with "no citations" purely because Claude paraphrased instead of
  // citing inline.
  if (out.length === 0) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; content?: unknown };
      if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
      for (const r of b.content as unknown[]) {
        if (!r || typeof r !== 'object') continue;
        const row = r as { type?: string; url?: unknown; title?: unknown };
        if (row.type !== 'web_search_result') continue;
        if (typeof row.url !== 'string' || seen.has(row.url)) continue;
        seen.add(row.url);
        out.push({
          url: row.url,
          title: typeof row.title === 'string' ? row.title : undefined
        });
      }
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
  console.log('[aiRefreshStock] AI returned keys', {
    itemId: input.itemId,
    seedTypeName: input.seedTypeName,
    keys: Object.keys(o),
    hasSeedDimensionsMm: 'seedDimensionsMm' in o,
    hasSeedShape: 'seedShape' in o
  });
  // Fallback citation when Claude returns raw values instead of the
  // `{ value, sourceUrl, sourceTitle }` wrapping the prompt asks for.
  // Better to attribute to the first cited URL than to drop the field
  // entirely — the operator can verify against the citations list.
  const defaultCite = citations[0];

  if (typeof o.notes === 'string') result.notes = o.notes.slice(0, 280);

  // Numeric seed fields — accept BOTH `{value: 110, sourceUrl: ...}` and raw `110`.
  copyNumberField(o, 'daysToMaturity', result, 1, 365, defaultCite);
  copyNumberField(o, 'plantingTempMinF', result, 0, 120, defaultCite);
  copyNumberField(o, 'spacingInches', result, 0.1, 240, defaultCite);
  copyNumberField(o, 'depthInches', result, 0, 12, defaultCite);
  copyNumberField(o, 'seedsPerPacket', result, 1, 100000, defaultCite);
  copyNumberField(o, 'matureHeightFt', result, 0.1, 60, defaultCite);

  // sunRequirement enum (wrapped or raw)
  const sunNorm = normalizeWrapped(o.sunRequirement, defaultCite);
  if (
    sunNorm &&
    typeof sunNorm.value === 'string' &&
    ['full-sun', 'partial-shade', 'full-shade'].includes(sunNorm.value)
  ) {
    result.sunRequirement = {
      value: sunNorm.value as 'full-sun' | 'partial-shade' | 'full-shade',
      sourceUrl: sunNorm.sourceUrl,
      sourceTitle: sunNorm.sourceTitle
    };
  }

  // activeIngredients (chem only) — `value` is an array; wrapper optional
  const aiNorm = normalizeWrapped(o.activeIngredients, defaultCite);
  if (aiNorm && Array.isArray(aiNorm.value)) {
    const cleaned = (aiNorm.value as unknown[])
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        if (typeof r.name !== 'string' || !r.name.trim()) return null;
        const out: Record<string, unknown> = { name: r.name.trim().slice(0, 120) };
        if (
          typeof r.concentrationPct === 'number' &&
          r.concentrationPct > 0 &&
          r.concentrationPct <= 100
        ) {
          out.concentrationPct = r.concentrationPct;
        }
        if (typeof r.chemistryClass === 'string')
          out.chemistryClass = r.chemistryClass.trim().slice(0, 64);
        if (typeof r.iracGroup === 'string' && /^[A-Z0-9]{1,4}$/.test(r.iracGroup))
          out.iracGroup = r.iracGroup;
        if (
          typeof r.fracCode === 'string' &&
          /^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/.test(r.fracCode)
        )
          out.fracCode = r.fracCode;
        return out;
      })
      .filter((x): x is Record<string, unknown> => x !== null);
    if (cleaned.length > 0) {
      result.activeIngredients = {
        value: cleaned as NonNullable<StockRefreshResult['activeIngredients']>['value'],
        sourceUrl: aiNorm.sourceUrl,
        sourceTitle: aiNorm.sourceTitle
      };
    }
  }

  // Fertilizer NPK (object value)
  const npkNorm = normalizeWrapped(o.npk, defaultCite);
  if (npkNorm && npkNorm.value && typeof npkNorm.value === 'object') {
    const v = npkNorm.value as { n?: unknown; p?: unknown; k?: unknown };
    if (
      typeof v.n === 'number' &&
      v.n >= 0 &&
      v.n <= 100 &&
      typeof v.p === 'number' &&
      v.p >= 0 &&
      v.p <= 100 &&
      typeof v.k === 'number' &&
      v.k >= 0 &&
      v.k <= 100
    ) {
      result.npk = {
        value: { n: v.n, p: v.p, k: v.k },
        sourceUrl: npkNorm.sourceUrl,
        sourceTitle: npkNorm.sourceTitle
      };
    }
  }

  const ftNorm = normalizeWrapped(o.formulationType, defaultCite);
  if (ftNorm && typeof ftNorm.value === 'string' && ftNorm.value.trim()) {
    result.formulationType = {
      value: ftNorm.value.trim().slice(0, 32),
      sourceUrl: ftNorm.sourceUrl,
      sourceTitle: ftNorm.sourceTitle
    };
  }

  const pcNorm = normalizeWrapped(o.productClass, defaultCite);
  if (
    pcNorm &&
    typeof pcNorm.value === 'string' &&
    ['synthetic', 'organic', 'biocontrol'].includes(pcNorm.value)
  ) {
    result.productClass = {
      value: pcNorm.value as 'synthetic' | 'organic' | 'biocontrol',
      sourceUrl: pcNorm.sourceUrl,
      sourceTitle: pcNorm.sourceTitle
    };
  }

  // Seed kernel dimensions (mm). Accept L/D/T plus common aliases
  // (length/width/depth/thickness) since Claude tends to drift on shorter
  // keys even when the prompt is explicit. Range gate is generous so we
  // catch class-level estimates as well as variety-specific values.
  const dimsNorm = normalizeWrapped(o.seedDimensionsMm, defaultCite);
  if (dimsNorm && dimsNorm.value && typeof dimsNorm.value === 'object') {
    const v = dimsNorm.value as Record<string, unknown>;
    const pickNum = (...keys: string[]): number | null => {
      for (const k of keys) {
        const cand = v[k];
        if (typeof cand === 'number' && cand > 0 && cand < 60) return cand;
      }
      return null;
    };
    const L = pickNum('L', 'length', 'Length');
    const D = pickNum('D', 'depth', 'Depth', 'width', 'Width');
    const T = pickNum('T', 'thickness', 'Thickness');
    if (L !== null && D !== null && T !== null) {
      result.seedDimensionsMm = {
        value: { L, D, T },
        sourceUrl: dimsNorm.sourceUrl,
        sourceTitle: dimsNorm.sourceTitle
      };
    } else {
      console.warn('[aiRefreshStock] seedDimensionsMm parse failed', {
        itemId: input.itemId,
        rawKeys: Object.keys(v),
        rawValue: v
      });
    }
  } else if (o.seedDimensionsMm !== undefined) {
    console.warn('[aiRefreshStock] seedDimensionsMm present but malformed', {
      itemId: input.itemId,
      raw: o.seedDimensionsMm
    });
  }

  // Seed shape enum (corn/soybean).
  const shapeNorm = normalizeWrapped(o.seedShape, defaultCite);
  if (
    shapeNorm &&
    typeof shapeNorm.value === 'string' &&
    ['Round', 'Flat'].includes(shapeNorm.value)
  ) {
    result.seedShape = {
      value: shapeNorm.value as 'Round' | 'Flat',
      sourceUrl: shapeNorm.sourceUrl,
      sourceTitle: shapeNorm.sourceTitle
    };
  }

  // Server-side deterministic plate pick — uses seedTypeName + AI-supplied
  // dims + shape against the Lincoln Ag catalog. No AI hallucination on the
  // plate itself; only the dims came from Claude.
  applyPlatePick(result, input);

  return result;
}

/**
 * Run the matching engine against the AI's seed-dimension suggestion to
 * pick a Lincoln Ag plate. Mutates `result.planterPlateConfig` in place.
 * Skipped when seed type is unknown or dimensions are absent.
 */
function applyPlatePick(result: StockRefreshResult, input: StockRefreshInput): void {
  // Only attempt for seed items.
  if (input.category !== 'seed') return;

  // Seed type is the hard gate — without it we can't pick the right
  // catalog slice. The fallback class defaults are keyed by seedType too.
  const seedType = inferSeedTypeFromName(input.seedTypeName);
  if (!seedType) {
    result.planterPlatePickNote = input.seedTypeName
      ? `No plate auto-picked: seed type "${input.seedTypeName}" does not map to the planter catalog. The catalog covers Corn, Sorghum, Soybean, Sunflower, and Sugar Beet.`
      : 'No plate auto-picked: this seed item has no Type set. Set the Type field (e.g., "Corn") in the inventory modal, then re-run Refresh.';
    console.log('[aiRefreshStock] applyPlatePick skipped: seedType could not be inferred', {
      itemId: input.itemId,
      seedTypeName: input.seedTypeName
    });
    return;
  }
  if (seedType === 'Sugar Beet') {
    result.planterPlatePickNote =
      'No plate auto-picked: Sugar Beet requires a Sugar Beet bottom — incompatible with standard corn planters. No records in the Lincoln Ag catalog for this type.';
    console.log('[aiRefreshStock] applyPlatePick skipped: Sugar Beet has no catalog entries', {
      itemId: input.itemId
    });
    return;
  }

  // Pick dimension source: AI-supplied → class-level default fallback.
  let dimSource: 'ai' | 'class-default' = 'ai';
  let L: number, D: number, T: number;
  let shape: 'Round' | 'Flat' | 'Either';
  let dimNote = '';

  if (result.seedDimensionsMm) {
    L = result.seedDimensionsMm.value.L;
    D = result.seedDimensionsMm.value.D;
    T = result.seedDimensionsMm.value.T;
    shape =
      result.seedShape && (result.seedShape.value === 'Round' || result.seedShape.value === 'Flat')
        ? result.seedShape.value
        : 'Either';
  } else {
    const defaults = CLASS_DEFAULT_DIMS_MM[seedType];
    if (!defaults) {
      // Shouldn't happen — Sugar Beet handled above, others have entries.
      console.warn('[aiRefreshStock] no class defaults for seedType', { seedType });
      return;
    }
    dimSource = 'class-default';
    L = defaults.L;
    D = defaults.D;
    T = defaults.T;
    shape = defaults.shape ?? 'Either';
    dimNote = defaults.note;

    // Populate seedDimensionsMm + seedShape so downstream surfaces (modal
    // review, planter-plate selector pre-fill) treat them like AI dims.
    // Citation is a self-attribution to the planter-plate engine — clear
    // signal that the value is class-level, not variety-specific.
    result.seedDimensionsMm = {
      value: { L, D, T },
      sourceTitle: `Class-level estimate: ${defaults.note}`
    };
    if (defaults.shape) {
      result.seedShape = {
        value: defaults.shape,
        sourceTitle: `Class-level estimate: ${defaults.note}`
      };
    }
  }

  const catalog = getPlatesCatalog();
  // 3mm-equivalent tolerance per dim. Generous enough to admit class-level
  // estimates (which are inherently coarser than variety-specific values)
  // and still narrow enough that genuinely poor matches get flagged
  // low-confidence by isLowConfidence.
  const toleranceInternal = mmToInternal(3);
  const matches = matchPlates(catalog, {
    seedType,
    shape: seedType === 'Corn' || seedType === 'Soybean' ? shape : 'Either',
    dimensions: { L: mmToInternal(L), D: mmToInternal(D), T: mmToInternal(T) },
    toleranceInternal,
    limit: 5
  });

  if (matches.length === 0) {
    const dimsLabel = dimSource === 'ai' ? 'AI-supplied' : `class-level estimate (${dimNote})`;
    result.planterPlatePickNote = `No plate auto-picked: no ${seedType} plates in the catalog matched the ${dimsLabel} dimensions (L=${L}mm, D=${D}mm, T=${T}mm) within tolerance. Use the manual selector to widen the search.`;
    console.log('[aiRefreshStock] applyPlatePick: no matches in catalog', {
      itemId: input.itemId,
      seedType,
      dimSource,
      dims: { L, D, T },
      shape
    });
    return;
  }
  // Class-default fallback always flagged low-confidence, even when delta
  // is small — the dims weren't from a real source for this variety.
  const conf = isLowConfidence(matches, true);
  const effectiveLowConfidence = conf.lowConfidence || dimSource === 'class-default';
  const top = matches[0];
  const sourceLabel =
    dimSource === 'ai'
      ? `AI-supplied dimensions L=${L}mm D=${D}mm T=${T}mm`
      : `class-level estimate (${dimNote}): L=${L}mm D=${D}mm T=${T}mm — no variety-specific kernel size found, so this is a starting point. Verify against your actual seed lot before committing.`;
  result.planterPlatePickNote = effectiveLowConfidence
    ? `Auto-picked ${top.plateNumber} (low confidence — ${dimSource === 'class-default' ? 'class-level estimate' : (conf.reason ?? 'see notes')}) using ${sourceLabel}. Verify with the manual selector before committing.`
    : `Auto-picked ${top.plateNumber} (${top.color}, ${top.dimensions} in 64ths) using ${sourceLabel}.`;
  console.log('[aiRefreshStock] applyPlatePick picked', {
    itemId: input.itemId,
    seedType,
    dimSource,
    dims: { L, D, T },
    shape,
    topPlate: top.plateNumber,
    topDelta: top.delta,
    matchCount: matches.length,
    lowConfidence: effectiveLowConfidence,
    reason: conf.reason
  });
  // Plate attribution: cite the same source as the dimensions (typically a
  // seed-grade chart), so the operator can audit it together.
  result.planterPlateConfig = {
    value: {
      plateNumber: top.plateNumber,
      series: top.series,
      brand: top.brand,
      cells: top.cells,
      color: top.color,
      dimensions: top.dimensions,
      L: top.L,
      D: top.D,
      T: top.T,
      shape: top.shape,
      seedType: top.seedType,
      gradeSize: top.gradeSize,
      lowConfidence: effectiveLowConfidence,
      confidenceReason:
        dimSource === 'class-default' ? `class-level estimate: ${dimNote}` : conf.reason,
      source: 'ai-suggested'
    },
    sourceUrl: result.seedDimensionsMm?.sourceUrl,
    sourceTitle: result.seedDimensionsMm?.sourceTitle
  };
}

/** Normalize a field that may arrive as either `{value, sourceUrl?, sourceTitle?}`
 *  or as a raw value. When raw, attributes to the supplied default citation
 *  (typically `citations[0]`) so the operator still has a URL to verify. */
function normalizeWrapped(
  raw: unknown,
  defaultCite: RawCitation | undefined
): { value: unknown; sourceUrl?: string; sourceTitle?: string } | null {
  if (raw === null || raw === undefined) return null;
  // Wrapped form
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if ('value' in r) {
      return {
        value: r.value,
        sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : defaultCite?.url,
        sourceTitle:
          typeof r.sourceTitle === 'string'
            ? r.sourceTitle
            : typeof r.sourceUrl === 'string'
              ? undefined
              : defaultCite?.title
      };
    }
    // Object without `value` — could be an unwrapped object value (npk).
    return {
      value: raw,
      sourceUrl: defaultCite?.url,
      sourceTitle: defaultCite?.title
    };
  }
  // Raw scalar / array
  return {
    value: raw,
    sourceUrl: defaultCite?.url,
    sourceTitle: defaultCite?.title
  };
}

function copyNumberField(
  src: Record<string, unknown>,
  key: keyof StockRefreshResult & string,
  dest: StockRefreshResult,
  min: number,
  max: number,
  defaultCite: RawCitation | undefined
): void {
  const norm = normalizeWrapped(src[key], defaultCite);
  if (!norm || typeof norm.value !== 'number') return;
  if (norm.value < min || norm.value > max) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dest as any)[key] = {
    value: norm.value,
    sourceUrl: norm.sourceUrl,
    sourceTitle: norm.sourceTitle
  };
}
