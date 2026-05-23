/**
 * Phase 22 / PR3 — Plugin Manager AI ingest paths.
 *
 * Three entry points, all producing the same `PluginCandidate` shape so the
 * UI can render one review card whether the source was a photo, a typed
 * query, or the local registry:
 *
 *   - `claudeVisionPluginLookup(image, hintType)` — Path A label scan.
 *   - `claudePluginSearchByName(query, hintType)` — Path B name search via
 *     Claude's web_search tool. Returns up to 3 ranked candidates.
 *   - `localFuzzyMatchPlugins(query, hintType)` — token-overlap match
 *     against the live registry. Free (no Anthropic call).
 *
 * Every Claude response is parsed defensively and run through
 * `pluginSchema.safeParse()` plus the `detectBypass()` dry-run against a
 * clone of the live registry — same gate the upload endpoint applies. The
 * UI never sees a candidate that would fail safety checks on commit.
 *
 * Server-only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PluginRegistrationError, PluginRegistry, pluginSchema, type Plugin } from '$lib/plugins';
import { getRegistry } from './registry';
import { AnthropicOverloadedError, getApiKey } from './scanResult';
import { selectModel, estimateUsd, type AiResultMeta } from './aiPlanning';

const MAX_VISION_TOKENS = 1500;
const MAX_SEARCH_TOKENS = 2500;
const MAX_WEB_SEARCHES = 4;
const MAX_CANDIDATES = 3;

export type PluginKindHint = Plugin['type'];

export interface CandidateIssue {
  path: string;
  message: string;
}

export interface PluginCandidate {
  /** Where the candidate came from. */
  source: 'claude-vision' | 'web-search' | 'local';
  /** Best-effort parsed payload. Null when Claude could not identify a
   *  product (e.g., a non-label image) or the response wasn't even close
   *  enough to recover a typed plugin. */
  candidate: Plugin | null;
  validation: {
    ok: boolean;
    schemaIssues: CandidateIssue[];
    bypassIssues: CandidateIssue[];
  };
  /** Self-reported confidence from Claude. UI badges this on the card. */
  confidence?: 'high' | 'medium' | 'low';
  /** Field paths Claude inferred (didn't read directly). UI highlights
   *  these so the operator double-checks them before commit. */
  guessed?: string[];
  /** web_search citations attached to the response (Path B only). */
  citations?: Array<{ url: string; title?: string }>;
  /** Local fuzzy-match score 0-1 (Path C local only). */
  score?: number;
}

export interface PluginSearchResponse {
  candidates: PluginCandidate[];
  source: 'local' | 'web-search' | 'mixed';
  meta: AiResultMeta & {
    fallback?: 'no-api-key' | 'no-results' | 'upstream-error';
    errorMessage?: string;
  };
}

const CHEMISTRY_CLASSES_FOR_PROMPT = [
  'synthetic-auxin',
  'chloroacetamide',
  'hppd-inhibitor',
  'accase-inhibitor',
  'glyphosate',
  'sulfonylurea',
  'microtubule-inhibitor',
  'photosystem-ii-triazine',
  'photosystem-i-diquat',
  'glufosinate',
  'ppo-inhibitor',
  'als-imidazolinone',
  'vlcfa-pyroxasulfone',
  'clomazone'
];

const CROP_FAMILIES_FOR_PROMPT = [
  'corn',
  'cucurbit',
  'solanaceae',
  'brassica',
  'allium',
  'leafy-green',
  'legume',
  'root',
  'small-fruit',
  'cane-fruit',
  'orchard',
  'stone-fruit',
  'vine-fruit',
  'apiaceae',
  'cereal-grain',
  'forage',
  'cover-crop',
  'culinary-herb',
  'broadleaf-companion'
];

/**
 * The prompt asks Claude to fill the minimum fields per plugin kind. Every
 * candidate is later run through the full Zod schema, so optional fields
 * are filled in only when Claude has evidence for them.
 */
const PLUGIN_SYSTEM_PROMPT = `You are a CropCard plugin author assistant. Your job is to convert a product label, a vendor page, or a typed product name into a JSON plugin payload that matches CropCard's plugin schema.

Return ONLY a JSON object — no prose, no code fences. The top-level shape is:

{
  "found": true,
  "confidence": "high" | "medium" | "low",
  "guessed": ["fieldPath1", "fieldPath2"],
  "plugin": { ... a single plugin object matching one of the six shapes below ... }
}

If you cannot identify a single product, return {"found": false, "reason": "..."}.

The "guessed" array names fields you inferred rather than read directly. Be honest — don't include a field you read off the label verbatim.

## Plugin shapes (by "type" discriminator)

ALL plugins MUST have:
  pluginId: kebab-case, 1-64 chars, [a-z0-9-]. Derive from the displayName.
  displayName: 1-120 chars human-readable.
  type: one of "crop" | "herbicide" | "insecticide" | "fungicide" | "fertilizer" | "companion".
  version: "1.0.0" for new plugins.
  pluginSchemaVersion: "1.1"

### crop
  cropFamily: one of [${CROP_FAMILIES_FOR_PROMPT.map((c) => `"${c}"`).join(', ')}]
  daysToMaturity (optional): { min: int, max: int }
  defaultRowSpacingInches (optional): number
  plantingGuide (optional): { soilTempMinF?: number, ... }
  harvestIndicators (optional): array of strings
  notes (optional): string

### herbicide
  activeIngredients: array of { name: string, chemistryClass: one of [${CHEMISTRY_CLASSES_FOR_PROMPT.map((c) => `"${c}"`).join(', ')}] }
  ratePerAcre: { amount: positive number, unit: "oz" | "fl-oz" | "lb" | "pt" | "qt" }
  gpaCalibration: int 1-100 (default 15)
  applicationTiming (optional): "BURNDOWN" | "PRE" | "POST" | "POST-DIRECTED"
  requiresAMS (optional): bool
  deconRequired (optional): bool
  epaRegistrationNumber (optional): "NNNNN-NNN" or "NNNNN-NNN-NNN"
  complianceFlags (optional): { omriListed?, nonGmoCompliant?, certifiedOrganicAllowed?, transitioningAllowed?, notes? }
  labelClaims.safeForCropPluginIds (optional): array of crop pluginIds. ONLY list crops the label explicitly claims safety on — never guess; the registry will reject claims that contradict the safety kernel.
  notes (optional): string

### insecticide
  activeIngredients: array of { name: string, iracGroup?: "1A"-"36" style code }
  ratePerAcre: { amount: positive number, unit: "oz" | "fl-oz" | "lb" | "pt" | "qt" }
  reEntryIntervalHours: nonneg int
  preHarvestIntervalDays (optional): nonneg int
  pollinatorRisk (optional): "none" | "low" | "moderate" | "high" | "unknown"
  targetPests (optional): array of strings (lowercase, hyphenated)
  scoutingThresholds (optional): array of { pest, metric, threshold, ... }
  complianceFlags (optional): { ... }

### fungicide
  activeIngredients: array of { name: string, fracCode: "M01" | "P01" | "U06" | "1"-"99" | "BM01" ... }
  ratePerAcre: { amount: positive number, unit: "oz" | "fl-oz" | "lb" | "pt" | "qt" }
  applicationTiming (optional): "PRE-BLOOM" | "BLOOM" | "COVER" | "POST-HARVEST"
  reEntryIntervalHours: nonneg int
  preHarvestIntervalDays (optional): nonneg int
  pollinatorRisk (optional)
  targetDiseases (optional): array of strings
  complianceFlags (optional)

### fertilizer
  analysis: { n: 0-100, p: 0-100, k: 0-100 } — guaranteed-analysis percent
  form: "granular" | "liquid" | "soluble" | "compost" | "slow-release" | "amendment"
  complianceFlags (optional)
  organic (optional): bool

### companion
  primaryFamily: cropFamily string
  members: array of { family, role: "primary"|"support"|"cover", plantingOffsetDays?: int, title, body? }
  goodWith (optional): array of crop pluginIds
  badWith (optional): array of crop pluginIds
  benefit (optional): string

## Rules
- NEVER fabricate a chemistry class, IRAC group, FRAC code, or N-P-K value. Leave the field absent if uncertain.
- NEVER list safeForCropPluginIds beyond what the label states. The safety kernel rejects bypass attempts.
- pluginId MUST be kebab-case. If the displayName is "Roundup PowerMax II", a reasonable pluginId is "roundup-powermax-ii".
- For Path B (typed name search), if you find multiple distinct products that match the query, return them as separate top-level "candidates" array entries instead of one plugin: { "found": true, "candidates": [ { confidence, guessed, plugin }, ... ] }.
- Output ONLY the JSON object. No prose, no code fences.`;

const candidateInnerSchema = z.object({
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  guessed: z.array(z.string()).optional(),
  plugin: z.unknown()
});

const visionResponseSchema = z.object({
  found: z.boolean().optional(),
  reason: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  guessed: z.array(z.string()).optional(),
  plugin: z.unknown().optional()
});

const searchResponseSchema = z.object({
  found: z.boolean().optional(),
  reason: z.string().optional(),
  candidates: z.array(candidateInnerSchema).optional(),
  /** Single-candidate fallback shape — same as vision. */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  guessed: z.array(z.string()).optional(),
  plugin: z.unknown().optional()
});

function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null;
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through to scan
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Coerce a raw plugin-shaped object into something `pluginSchema` is
 *  likely to accept: derive a slug pluginId when missing, default the
 *  version, and stamp `pluginSchemaVersion: '1.1'`. Returns the coerced
 *  object; never throws. */
function normalizeCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (!obj.version || typeof obj.version !== 'string') {
    obj.version = '1.0.0';
  }
  if (!obj.pluginSchemaVersion) {
    obj.pluginSchemaVersion = '1.1';
  }
  const displayName = typeof obj.displayName === 'string' ? obj.displayName : '';
  if (!obj.pluginId || typeof obj.pluginId !== 'string' || obj.pluginId.length === 0) {
    if (displayName) {
      obj.pluginId = slugify(displayName);
    }
  } else if (typeof obj.pluginId === 'string') {
    obj.pluginId = slugify(obj.pluginId);
  }
  return obj;
}

async function buildProbeRegistry(): Promise<PluginRegistry> {
  const live = await getRegistry();
  const probe = new PluginRegistry();
  for (const r of live.all()) {
    probe.register(r.plugin);
  }
  return probe;
}

/** Dry-run a candidate through the same validation pipeline the upload
 *  endpoint uses. Returns the typed Plugin on success + validation issues
 *  on failure. Never throws. */
export async function validateCandidate(rawCandidate: unknown): Promise<{
  candidate: Plugin | null;
  validation: PluginCandidate['validation'];
}> {
  const normalized = normalizeCandidate(rawCandidate);
  const parsed = pluginSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      candidate: null,
      validation: {
        ok: false,
        schemaIssues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        })),
        bypassIssues: []
      }
    };
  }
  const probe = await buildProbeRegistry();
  const conflictWithId = probe.has(parsed.data.pluginId);
  if (conflictWithId) {
    return {
      candidate: parsed.data,
      validation: {
        ok: false,
        schemaIssues: [
          {
            path: 'pluginId',
            message: `pluginId '${parsed.data.pluginId}' already exists in the registry. Pick a different slug or edit the existing plugin from /plugins/${parsed.data.pluginId}.`
          }
        ],
        bypassIssues: []
      }
    };
  }
  try {
    probe.register(parsed.data);
    return {
      candidate: parsed.data,
      validation: { ok: true, schemaIssues: [], bypassIssues: [] }
    };
  } catch (err) {
    if (err instanceof PluginRegistrationError) {
      return {
        candidate: parsed.data,
        validation: {
          ok: false,
          schemaIssues: [],
          bypassIssues: err.issues
        }
      };
    }
    return {
      candidate: parsed.data,
      validation: {
        ok: false,
        schemaIssues: [{ path: '', message: err instanceof Error ? err.message : String(err) }],
        bypassIssues: []
      }
    };
  }
}

function collectCitations(
  content: Anthropic.Messages.ContentBlock[]
): Array<{ url: string; title?: string }> {
  const out = new Map<string, { url: string; title?: string }>();
  for (const block of content) {
    if (block.type !== 'text') continue;
    const cites = (block as unknown as { citations?: Array<{ url?: string; title?: string }> })
      .citations;
    if (!Array.isArray(cites)) continue;
    for (const c of cites) {
      if (typeof c.url !== 'string') continue;
      if (!out.has(c.url)) out.set(c.url, { url: c.url, title: c.title });
    }
  }
  return Array.from(out.values());
}

function buildVisionUserPrompt(hintType?: PluginKindHint): string {
  const hint = hintType ? ` The operator says this is a ${hintType} product.` : '';
  return (
    `Read this farm-supply product label.${hint} Return the structured JSON object described in the system message. ` +
    `Pick the correct "type" discriminator from what's on the label. If the image is not a product label, return {"found": false, "reason": "..."}.`
  );
}

function buildSearchUserPrompt(query: string, hintType?: PluginKindHint): string {
  const hint = hintType ? `The operator says this should be a "${hintType}" plugin.` : '';
  return [
    `You MUST use the web_search tool. Find up to ${MAX_CANDIDATES} CropCard plugin candidates matching the operator's query.`,
    '',
    `Operator query: "${query}"`,
    hint,
    '',
    '## Search strategy',
    `Run 2-${MAX_WEB_SEARCHES} web_search queries. Start with the literal query, then narrow with terms like "label PDF", "active ingredient", "FRAC code", "days to maturity", "seed catalog".`,
    '',
    'Authoritative sources, in priority order:',
    '  - Pesticides: EPA label PDF, manufacturer label, CDMS / Greenbook',
    "  - Seeds: Johnny's Selected Seeds, Baker Creek, High Mowing, Botanical Interests, university extension",
    '  - Fertilizers: manufacturer guaranteed-analysis label, OMRI listings',
    '',
    '## Output',
    'If you find multiple matching products, return:',
    '{ "found": true, "candidates": [ {"confidence": "...", "guessed": [...], "plugin": {...}}, ... ] }',
    '',
    'If you find exactly one match, you may return either the multi-candidate shape (with one entry) or the single-candidate shape:',
    '{ "found": true, "confidence": "...", "guessed": [...], "plugin": {...} }',
    '',
    'If you find nothing, return: { "found": false, "reason": "..." }',
    '',
    'Output ONLY the JSON object — no prose, no code fences.'
  ].join('\n');
}

/** Path A — single label photo → 1 plugin candidate. */
export async function claudeVisionPluginLookup(
  base64jpeg: string,
  hintType?: PluginKindHint
): Promise<{ candidate: PluginCandidate | null; meta: AiResultMeta }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      candidate: null,
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0
      }
    };
  }
  const client = new Anthropic({ apiKey });
  const choice = selectModel('rationale');
  const userPrompt = buildVisionUserPrompt(hintType);

  const msg = await client.messages.create({
    model: choice.model,
    max_tokens: MAX_VISION_TOKENS,
    system: PLUGIN_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64jpeg }
          },
          { type: 'text', text: userPrompt }
        ]
      }
    ]
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

  const textBlock = msg.content.find((c) => c.type === 'text');
  const text = textBlock?.type === 'text' ? textBlock.text : '';
  const json = extractJsonObject(text);
  const parsed = visionResponseSchema.safeParse(json);

  if (!parsed.success || parsed.data.found === false || !parsed.data.plugin) {
    return { candidate: null, meta };
  }

  const validation = await validateCandidate(parsed.data.plugin);
  return {
    candidate: {
      source: 'claude-vision',
      candidate: validation.candidate,
      validation: validation.validation,
      confidence: parsed.data.confidence,
      guessed: parsed.data.guessed
    },
    meta
  };
}

/** Path B (AI branch) — typed query → ≤3 ranked candidates via web_search. */
export async function claudePluginSearchByName(
  query: string,
  hintType?: PluginKindHint
): Promise<{
  candidates: PluginCandidate[];
  citations: Array<{ url: string; title?: string }>;
  meta: AiResultMeta;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      candidates: [],
      citations: [],
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0
      }
    };
  }
  const client = new Anthropic({ apiKey });
  const choice = selectModel('rationale');
  const userPrompt = buildSearchUserPrompt(query, hintType);

  const msg = await client.messages.create({
    model: choice.model,
    max_tokens: MAX_SEARCH_TOKENS,
    system: PLUGIN_SYSTEM_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_WEB_SEARCHES
      }
    ],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
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

  const textBlocks = msg.content.filter((c) => c.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  const text = lastText?.type === 'text' ? lastText.text : '';
  const citations = collectCitations(msg.content);

  const json = extractJsonObject(text);
  const parsed = searchResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.found === false) {
    return { candidates: [], citations, meta };
  }

  const rawCandidates: Array<{
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    plugin: unknown;
  }> = [];
  if (Array.isArray(parsed.data.candidates) && parsed.data.candidates.length > 0) {
    for (const c of parsed.data.candidates.slice(0, MAX_CANDIDATES)) {
      rawCandidates.push({ confidence: c.confidence, guessed: c.guessed, plugin: c.plugin });
    }
  } else if (parsed.data.plugin !== undefined) {
    rawCandidates.push({
      confidence: parsed.data.confidence,
      guessed: parsed.data.guessed,
      plugin: parsed.data.plugin
    });
  }

  const out: PluginCandidate[] = [];
  for (const rc of rawCandidates) {
    const v = await validateCandidate(rc.plugin);
    out.push({
      source: 'web-search',
      candidate: v.candidate,
      validation: v.validation,
      confidence: rc.confidence,
      guessed: rc.guessed,
      citations: citations.length > 0 ? citations : undefined
    });
  }
  return { candidates: out, citations, meta };
}

/** Path B (local branch) — token-overlap match against the live registry.
 *  No AI call; safe to run on every keystroke (debounced client-side). */
export async function localFuzzyMatchPlugins(
  query: string,
  hintType?: PluginKindHint,
  limit = MAX_CANDIDATES
): Promise<PluginCandidate[]> {
  if (!query || query.trim().length < 2) return [];
  const tokA = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 2)
  );
  if (tokA.size === 0) return [];
  const registry = await getRegistry();
  const scored = registry
    .all()
    .filter((r) => (hintType ? r.plugin.type === hintType : true))
    .map((r) => {
      const tokB = new Set(
        r.plugin.displayName
          .toLowerCase()
          .split(/\W+/)
          .filter((t) => t.length >= 2)
      );
      const idTokens = r.plugin.pluginId.toLowerCase().split('-');
      for (const t of idTokens) {
        if (t.length >= 2) tokB.add(t);
      }
      let shared = 0;
      for (const t of tokA) if (tokB.has(t)) shared++;
      const max = Math.max(tokA.size, tokB.size);
      const score = max > 0 ? shared / max : 0;
      return { record: r, score };
    })
    .filter((m) => m.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => ({
    source: 'local' as const,
    candidate: s.record.plugin,
    validation: { ok: true, schemaIssues: [], bypassIssues: [] },
    score: s.score
  }));
}

// ─── Streaming variant for live status updates ─────────────────────────
//
// Same Path-B web_search behavior, but emits stage events as Claude
// progresses through tool_use → text generation. The endpoint wraps the
// callback in SSE frames; the client renders the latest message in real
// time so the operator can see what the model is doing instead of staring
// at a static "Searching…" spinner.

export type SearchStreamEvent =
  | { phase: 'starting'; message: string }
  | { phase: 'searching'; message: string; query?: string; index?: number; total?: number }
  | { phase: 'results'; message: string; resultCount?: number }
  | { phase: 'parsing'; message: string }
  | { phase: 'validating'; message: string }
  | {
      phase: 'complete';
      candidates: PluginCandidate[];
      citations: Array<{ url: string; title?: string }>;
      meta: AiResultMeta;
    }
  | { phase: 'error'; message: string };

export async function claudePluginSearchByNameStreaming(
  query: string,
  hintType: PluginKindHint | undefined,
  send: (event: SearchStreamEvent) => void
): Promise<{ meta: AiResultMeta; candidates: PluginCandidate[] }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    send({ phase: 'error', message: 'No Anthropic API key configured.' });
    return {
      candidates: [],
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0
      }
    };
  }

  const client = new Anthropic({ apiKey });
  const choice = selectModel('rationale');
  const userPrompt = buildSearchUserPrompt(query, hintType);

  send({ phase: 'starting', message: `Asking Claude (${choice.model}) to look up "${query}"…` });

  let searchIndex = 0;

  const stream = client.messages.stream({
    model: choice.model,
    max_tokens: MAX_SEARCH_TOKENS,
    system: PLUGIN_SYSTEM_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_WEB_SEARCHES
      }
    ],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
  });

  stream.on('streamEvent', (event) => {
    if (event.type === 'content_block_start') {
      const block = event.content_block as { type: string; input?: { query?: string } };
      if (block.type === 'server_tool_use') {
        searchIndex++;
        send({
          phase: 'searching',
          message: `Searching the web (${searchIndex}/${MAX_WEB_SEARCHES})…`,
          index: searchIndex,
          total: MAX_WEB_SEARCHES
        });
      } else if (block.type === 'web_search_tool_result') {
        const results = (event.content_block as unknown as { content?: unknown[] }).content;
        const count = Array.isArray(results) ? results.length : 0;
        send({
          phase: 'results',
          message:
            count > 0
              ? `Got ${count} source${count === 1 ? '' : 's'} back; continuing…`
              : 'No matches on that query; trying another…',
          resultCount: count
        });
      } else if (block.type === 'text') {
        send({ phase: 'parsing', message: 'Building candidate plugins from the sources…' });
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as { type: string; partial_json?: string; query?: string };
      // Anthropic emits the search query as an input_json_delta on the
      // server_tool_use block. Surface it as soon as the first chunk
      // arrives so the operator sees what's being searched for.
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        const match = delta.partial_json.match(/"query"\s*:\s*"([^"]{2,})/);
        if (match) {
          send({
            phase: 'searching',
            message: `Searching: "${match[1]}…"`,
            query: match[1]
          });
        }
      }
    }
  });

  const finalMsg = await stream.finalMessage();

  const usage = finalMsg.usage as {
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

  send({ phase: 'validating', message: 'Validating candidates against the safety kernel…' });

  const textBlocks = finalMsg.content.filter((c) => c.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  const text = lastText?.type === 'text' ? lastText.text : '';
  const citations = collectCitations(finalMsg.content);

  const json = extractJsonObject(text);
  const parsed = searchResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.found === false) {
    send({ phase: 'complete', candidates: [], citations, meta });
    return { candidates: [], meta };
  }

  const rawCandidates: Array<{
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    plugin: unknown;
  }> = [];
  if (Array.isArray(parsed.data.candidates) && parsed.data.candidates.length > 0) {
    for (const c of parsed.data.candidates.slice(0, MAX_CANDIDATES)) {
      rawCandidates.push({ confidence: c.confidence, guessed: c.guessed, plugin: c.plugin });
    }
  } else if (parsed.data.plugin !== undefined) {
    rawCandidates.push({
      confidence: parsed.data.confidence,
      guessed: parsed.data.guessed,
      plugin: parsed.data.plugin
    });
  }

  const candidates: PluginCandidate[] = [];
  for (const rc of rawCandidates) {
    const v = await validateCandidate(rc.plugin);
    candidates.push({
      source: 'web-search',
      candidate: v.candidate,
      validation: v.validation,
      confidence: rc.confidence,
      guessed: rc.guessed,
      citations: citations.length > 0 ? citations : undefined
    });
  }

  send({ phase: 'complete', candidates, citations, meta });
  return { candidates, meta };
}

// ─── Receipt / manifest scan (Path C) ──────────────────────────────────
//
// Two-phase pipeline:
//   1. Vision pass on the receipt image / PDF page: extract line items as
//      `{ rawText, productName, sku?, qty?, unit?, vendor? }`. No plugin
//      shapes yet — just line extraction.
//   2. Per-line enrichment via the existing web_search path. Each line
//      runs through `claudePluginSearchByName` and yields the top
//      candidate.
//
// Streaming events let the UI render progress as each line is processed.

export type ReceiptStreamEvent =
  | { phase: 'starting'; message: string }
  | { phase: 'extracting'; message: string }
  | {
      phase: 'extracted';
      message: string;
      lines: Array<ReceiptLineItem>;
    }
  | {
      phase: 'enriching';
      message: string;
      lineIndex: number;
      totalLines: number;
      rawText: string;
    }
  | {
      phase: 'enriched';
      message: string;
      lineIndex: number;
      candidate: PluginCandidate | null;
    }
  | {
      phase: 'complete';
      message: string;
      proposed: Array<ReceiptProposal>;
      meta: AiResultMeta;
    }
  | { phase: 'error'; message: string };

export interface ReceiptLineItem {
  rawText: string;
  productName?: string;
  sku?: string;
  qty?: number;
  unit?: string;
  vendor?: string;
}

export interface ReceiptProposal {
  lineIndex: number;
  line: ReceiptLineItem;
  candidate: PluginCandidate | null;
}

const receiptLineSchema = z.object({
  rawText: z.string().min(1),
  productName: z.string().optional(),
  sku: z.string().optional(),
  qty: z.number().optional(),
  unit: z.string().optional(),
  vendor: z.string().optional()
});

const receiptExtractionSchema = z.object({
  found: z.boolean().optional(),
  reason: z.string().optional(),
  vendor: z.string().optional(),
  lines: z.array(receiptLineSchema).optional()
});

const RECEIPT_SYSTEM_PROMPT = `You are an agricultural-supply receipt parser. Given an image of a vendor receipt, invoice, packing list, or order confirmation, extract every distinct product line item.

Return ONLY a JSON object:
{
  "found": true,
  "vendor": "Tractor Supply" | "Southern States" | "..." (optional, from the header),
  "lines": [
    {
      "rawText": "exact line as printed on the receipt",
      "productName": "cleaned product name (manufacturer + product)",
      "sku": "if printed",
      "qty": <number>,
      "unit": "qt|gal|lb|oz|each|...",
      "vendor": "if vendor differs per line"
    }
  ]
}

If the image is NOT a receipt/invoice/packing list (e.g. a single product label, an empty page), return {"found": false, "reason": "..."}.

Rules:
- Skip non-product lines: shipping, tax, freight, discounts, totals, payment lines.
- Keep one entry per distinct product. Repeated SKUs are still one entry — combine the qty.
- Be conservative with productName: only what's printed. If unclear, leave it absent and let rawText carry the original text.
- DO NOT fabricate SKUs or quantities. Omit if not on the receipt.
- Max 30 line items per receipt.`;

export async function claudeReceiptExtract(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf' = 'image/jpeg'
): Promise<{ lines: ReceiptLineItem[]; vendor?: string; meta: AiResultMeta }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      lines: [],
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0
      }
    };
  }
  const client = new Anthropic({ apiKey });
  const choice = selectModel('rationale');

  // The Anthropic SDK accepts `document` content blocks for PDFs and
  // `image` blocks for raster images. The two have incompatible inner
  // types; the SDK's `ContentBlockParam` union covers both. Cast the
  // content array through `unknown` so we can hand it the right shape
  // for whichever mediaType arrived.
  const docBlock: unknown =
    mediaType === 'application/pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Image }
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Image }
        };

  const msg = await client.messages.create({
    model: choice.model,
    max_tokens: 2500,
    system: RECEIPT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          docBlock,
          {
            type: 'text',
            text: 'Parse the line items off this farm-supply receipt and return the structured JSON.'
          }
        ] as unknown as Anthropic.Messages.ContentBlockParam[]
      }
    ]
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

  const textBlock = msg.content.find((c) => c.type === 'text');
  const text = textBlock?.type === 'text' ? textBlock.text : '';
  const json = extractJsonObject(text);
  const parsed = receiptExtractionSchema.safeParse(json);
  if (!parsed.success || parsed.data.found === false) {
    return { lines: [], vendor: undefined, meta };
  }
  const lines = (parsed.data.lines ?? []).slice(0, 30);
  return { lines, vendor: parsed.data.vendor, meta };
}

/** Full streaming pipeline: extract lines, then enrich each one. */
export async function claudeReceiptScanStreaming(
  base64Image: string,
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf',
  send: (event: ReceiptStreamEvent) => void
): Promise<{ proposed: ReceiptProposal[]; meta: AiResultMeta }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    send({ phase: 'error', message: 'No Anthropic API key configured.' });
    return {
      proposed: [],
      meta: {
        model: 'n/a',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0
      }
    };
  }

  send({ phase: 'starting', message: 'Asking Claude to extract line items from the receipt…' });
  send({ phase: 'extracting', message: 'Parsing receipt with Claude vision…' });

  const extraction = await claudeReceiptExtract(base64Image, mediaType);
  const lines = extraction.lines;

  if (lines.length === 0) {
    send({
      phase: 'error',
      message:
        "Claude couldn't identify any product line items on this image. Try a clearer photo, or upload the original PDF instead of a phone photo of a printout."
    });
    return { proposed: [], meta: extraction.meta };
  }

  send({
    phase: 'extracted',
    message: `Got ${lines.length} line item${lines.length === 1 ? '' : 's'}${
      extraction.vendor ? ` from ${extraction.vendor}` : ''
    }. Looking each up online…`,
    lines
  });

  const proposed: ReceiptProposal[] = [];
  const aggregateMeta: AiResultMeta = { ...extraction.meta };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const query = line.productName || line.rawText;
    send({
      phase: 'enriching',
      message: `Looking up line ${i + 1}/${lines.length}: ${query.slice(0, 60)}${
        query.length > 60 ? '…' : ''
      }`,
      lineIndex: i,
      totalLines: lines.length,
      rawText: line.rawText
    });

    try {
      const r = await claudePluginSearchByName(query, undefined);
      const candidate = r.candidates[0] ?? null;
      proposed.push({ lineIndex: i, line, candidate });
      aggregateMeta.inputTokens += r.meta.inputTokens;
      aggregateMeta.cachedInputTokens += r.meta.cachedInputTokens;
      aggregateMeta.outputTokens += r.meta.outputTokens;
      aggregateMeta.usdEstimate += r.meta.usdEstimate;
      send({
        phase: 'enriched',
        message: candidate
          ? `Line ${i + 1}: ${(candidate.candidate?.displayName as string) ?? 'identified'} (${
              candidate.confidence ?? '?'
            } confidence)`
          : `Line ${i + 1}: no match found`,
        lineIndex: i,
        candidate
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      proposed.push({ lineIndex: i, line, candidate: null });
      send({
        phase: 'enriched',
        message: `Line ${i + 1}: lookup failed — ${message}`,
        lineIndex: i,
        candidate: null
      });
    }
  }

  send({
    phase: 'complete',
    message: `Processed ${lines.length} line${lines.length === 1 ? '' : 's'}. Review the candidates and accept the ones you want.`,
    proposed,
    meta: aggregateMeta
  });

  return { proposed, meta: aggregateMeta };
}

export { AnthropicOverloadedError };
