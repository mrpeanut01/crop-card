/**
 * Shared types and Claude prompt logic for barcode + label scan endpoints.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { StockCategory } from '$lib/db/stock';
import { getRegistry } from '$lib/server/registry';
import { getSetting } from '$lib/db/settings';

export interface SeedMeta {
  daysToMaturity?: number;
  plantingTempMinF?: number;
  plantingTempMaxF?: number;
  spacingInches?: number;
  depthInches?: number;
  sunRequirement?: 'full-sun' | 'partial-shade' | 'full-shade';
  seedsPerPacket?: number;
}

export interface CropPluginMatch {
  pluginId: string;
  displayName: string;
  score: number;
}

export interface SuggestedType {
  /** Existing taxonomy term id when Claude's suggestion matches one. */
  matchedTypeId?: string;
  /** The Type label (matched name or new suggestion). */
  name: string;
  /** True when no existing term matched — UI prompts the user to add it. */
  isNew: boolean;
}

/** Phase 17 (Track 2) — AI-extracted active ingredient line from a label
 *  scan. Mirrored into stockItems.activeIngredientsJson on user confirm. */
export interface ScannedActiveIngredient {
  name: string;
  /** Active-ingredient concentration as percent by weight (0..100). */
  concentrationPct?: number;
  /** Free-form chemistry class string ("glyphosate", "synthetic-auxin",
   *  "neonicotinoid", etc.). Validated against the kernel's
   *  CHEMISTRY_CLASSES enum on the server before persistence. */
  chemistryClass?: string;
  /** IRAC mode-of-action group (insecticides). */
  iracGroup?: string;
  /** FRAC code (fungicides). */
  fracCode?: string;
}

/** Phase 17 (Track 2) — AI-extracted formulation block. Mirrored into
 *  stockItems.formulationJson on user confirm. */
export interface ScannedFormulation {
  type?: string;
  npk?: { n: number; p: number; k: number };
  productClass?: 'synthetic' | 'organic' | 'biocontrol';
}

export interface ScanResult {
  found: boolean;
  displayName?: string;
  /** Phase 15d — Haiku-style short label (≤40 chars) generated alongside
   *  displayName during a label scan. Surfaced on schedule bars + wizard
   *  cards. Falls back to displayName if the scan didn't supply one. */
  shortName?: string;
  category?: StockCategory;
  defaultUnit?: string;
  /** Quantity printed on the package, in defaultUnit. Drives the Initial qty field. */
  packageQuantity?: number;
  reorderThreshold?: number;
  notes?: string;
  seedMeta?: SeedMeta;
  /** Phase 17 (Track 2) — AI-extracted active ingredients (chem products only). */
  activeIngredients?: ScannedActiveIngredient[];
  /** Phase 17 (Track 2) — AI-extracted formulation block. */
  formulation?: ScannedFormulation;
  /** Field names Claude inferred rather than read directly from the label/data. */
  guessed?: string[];
  source: 'openfoodfacts' | 'claude' | 'claude-vision' | 'claude-url' | 'none';
  barcode?: string;
  existingStockItemId?: string;
  cropPluginMatches?: CropPluginMatch[];
  /** Type suggestion the UI displays for confirmation (mapped or new). */
  suggestedType?: SuggestedType;
}

export const STOCK_CATEGORIES = [
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer',
  'seed',
  'adjuvant',
  'fuel',
  'part'
] as const;

// Matches a token-overlap fuzzy score ≥ 0.3 against all crop plugins.
export async function matchCropPlugins(displayName: string): Promise<CropPluginMatch[]> {
  try {
    const registry = await getRegistry();
    const tokA = new Set(displayName.toLowerCase().split(/\W+/).filter(Boolean));
    return registry
      .crops()
      .map((p) => {
        const tokB = new Set(p.displayName.toLowerCase().split(/\W+/).filter(Boolean));
        let shared = 0;
        for (const t of tokA) {
          if (tokB.has(t)) shared++;
        }
        const max = Math.max(tokA.size, tokB.size);
        return { pluginId: p.pluginId, displayName: p.displayName, score: max ? shared / max : 0 };
      })
      .filter((m) => m.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function getApiKey(): string {
  return process.env.ANTHROPIC_API_KEY || getSetting('anthropic_api_key') || '';
}

const SYSTEM_PROMPT = `You are a farm supply inventory assistant. Given product information, return ONLY a valid JSON object — no markdown, no extra text.

Required fields:
- displayName: string (product name as it would appear on a shelf label)
- shortName: string ≤40 chars — a TERSE label for crowded UI (schedule bars). Lead with the variety/cultivar then the crop type. Drop marketing terms ("Treated", "Untreated", "Non-GMO", "Raw", "Film Coated", pack sizes, supplier names). Examples: "Pumpkin Cinderella Film Coated Treated" → "Cinderella Pumpkin"; "Bloody Butcher Ornamental Corn — Raw Untreated Non-GMO (1/2 lb)" → "Bloody Butcher Corn"; "Roundup PowerMax II Glyphosate" → "Roundup PowerMax". Title-case, no quotes, no emoji. 1-4 words.
- category: one of exactly: herbicide|insecticide|fungicide|fertilizer|seed|adjuvant|fuel|part
- defaultUnit: string — the natural unit for this product type. For seeds use "count" or "lb". For liquids use "fl-oz", "qt", "gal". For dry material use "lb", "oz", "bag".
- packageQuantity: number — the amount **printed on this specific package**, expressed in defaultUnit. Read it directly from the label whenever possible. Examples: a "1 Quart" herbicide → 32 (defaultUnit "fl-oz") or 1 (defaultUnit "qt"); a "5 lb" fertilizer bag → 5 (defaultUnit "lb"); a "100 seeds" packet → 100 (defaultUnit "count"). Omit if you genuinely cannot tell.
- reorderThreshold: number — suggest a sensible low-stock reorder level in the defaultUnit (e.g. 2 for packets, 32 for fl-oz of herbicide). Use your best judgement.
- notes: string ≤120 chars — key facts from the label (variety type, certifications, etc.). Empty string if nothing useful.
- guessed: string[] — list ONLY the field names above that you inferred rather than read directly from the label/data. Be honest — if the label clearly states a value, do NOT include it in guessed.
- type: string — a sub-category label that fits within the category. Examples by category:
    seed → "Solanaceae", "Brassicas", "Cucurbits", "Alliums", "Leafy greens", "Root crops", "Cereal grain", "Forage", "Culinary herbs", "Corn", "Cover crop — grass", "Cover crop — legume", "Stone fruit", "Vine fruit", "Brambles", "Small fruit", "Apiaceae", "Orchard", "Legumes", "Broadleaf companion"
    herbicide → "Burndown", "Pre-emergent", "Post-emergent", "Selective"
    insecticide → "Contact", "Systemic", "Bt / biological"
    fungicide → "Protectant", "Systemic"
    fertilizer → "Granular", "Liquid", "Compost / manure"
  Prefer one of these canonical labels exactly when applicable. Use a short new label (1-3 words) only when none fit.

Additionally, if category is "seed", include a "seedMeta" object with any of these you can determine:
- daysToMaturity: number (days)
- plantingTempMinF: number (°F soil temp)
- plantingTempMaxF: number (°F soil temp)
- spacingInches: number
- depthInches: number
- sunRequirement: "full-sun" | "partial-shade" | "full-shade"
- seedsPerPacket: number

Add any inferred seedMeta field names to the "guessed" array.

If category is "herbicide", "insecticide", or "fungicide", include an "activeIngredients" array (one entry per active ingredient on the label):
- name: string — common chemical name (e.g., "Glyphosate", "2,4-D dimethylamine salt", "Imidacloprid", "Azoxystrobin")
- concentrationPct: number — guaranteed-analysis percent by weight as printed (e.g., 41 for "41% Glyphosate isopropylamine salt"). Omit if not on the label.
- chemistryClass: string — class identifier when known. Use one of these exact strings when applicable: "glyphosate", "synthetic-auxin" (covers 2,4-D, dicamba, MCPA), "ALS-inhibitor", "HPPD-inhibitor", "ACCase-inhibitor", "PPO-inhibitor", "PSII-inhibitor", "VLCFA-inhibitor", "glufosinate", "paraquat", "atrazine", "neonicotinoid", "pyrethroid", "organophosphate", "carbamate", "Bt", "spinosyn", "diamide", "azole", "strobilurin", "copper", "sulfur". Omit if uncertain — never guess.
- iracGroup: string — IRAC mode-of-action group (insecticides only, e.g., "1A", "3A", "4A", "11A").
- fracCode: string — FRAC code (fungicides only, e.g., "M01", "11", "21", "P01").

If category is "fertilizer", include a "formulation" object:
- npk: { n: number, p: number, k: number } — guaranteed-analysis percent (e.g., 10-10-10 → {n:10, p:10, k:10}).
- type: string — physical form ("granular", "liquid", "soluble", "compost", "slow-release").
- productClass: "synthetic" | "organic" | "biocontrol" — when the label asserts an OMRI/organic claim, mark "organic"; biocontrols (Bt, Trichoderma, beneficial nematodes) are "biocontrol"; everything else is "synthetic".

For chem products, the same "formulation" object should carry "type" (e.g., "EC", "WP", "WDG", "SL", "granular") and "productClass".

Add any inferred field names from activeIngredients/formulation/seedMeta to the "guessed" array. NEVER fabricate a chemistryClass, iracGroup, fracCode, or NPK value — leave it absent if uncertain.

If you cannot identify the product at all, return {"found": false}.`;

// Parse and validate a raw Claude JSON string into a partial ScanResult.
export function parseClaudeJson(raw: string): Partial<ScanResult> {
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
  const data = JSON.parse(cleaned);
  if (data.found === false) return { found: false };

  const cat = STOCK_CATEGORIES.includes(data.category)
    ? (data.category as StockCategory)
    : undefined;
  const seedMeta: SeedMeta | undefined =
    cat === 'seed' && data.seedMeta
      ? {
          daysToMaturity:
            typeof data.seedMeta.daysToMaturity === 'number'
              ? data.seedMeta.daysToMaturity
              : undefined,
          plantingTempMinF:
            typeof data.seedMeta.plantingTempMinF === 'number'
              ? data.seedMeta.plantingTempMinF
              : undefined,
          plantingTempMaxF:
            typeof data.seedMeta.plantingTempMaxF === 'number'
              ? data.seedMeta.plantingTempMaxF
              : undefined,
          spacingInches:
            typeof data.seedMeta.spacingInches === 'number'
              ? data.seedMeta.spacingInches
              : undefined,
          depthInches:
            typeof data.seedMeta.depthInches === 'number' ? data.seedMeta.depthInches : undefined,
          sunRequirement: ['full-sun', 'partial-shade', 'full-shade'].includes(
            data.seedMeta.sunRequirement
          )
            ? data.seedMeta.sunRequirement
            : undefined,
          seedsPerPacket:
            typeof data.seedMeta.seedsPerPacket === 'number'
              ? data.seedMeta.seedsPerPacket
              : undefined
        }
      : undefined;

  const shortNameRaw = typeof data.shortName === 'string' ? data.shortName.trim() : '';
  const shortName =
    shortNameRaw &&
    shortNameRaw.length > 0 &&
    shortNameRaw.length <= 40 &&
    !/[\x00-\x1f]/.test(shortNameRaw)
      ? shortNameRaw
      : undefined;

  // Phase 17 (Track 2) — active ingredients (chem products only).
  const activeIngredients: ScannedActiveIngredient[] | undefined =
    Array.isArray(data.activeIngredients) &&
    (cat === 'herbicide' || cat === 'insecticide' || cat === 'fungicide')
      ? (data.activeIngredients as unknown[])
          .map((raw): ScannedActiveIngredient | null => {
            if (!raw || typeof raw !== 'object') return null;
            const r = raw as Record<string, unknown>;
            if (typeof r.name !== 'string' || !r.name.trim()) return null;
            const out: ScannedActiveIngredient = { name: r.name.trim().slice(0, 120) };
            if (
              typeof r.concentrationPct === 'number' &&
              r.concentrationPct > 0 &&
              r.concentrationPct <= 100
            ) {
              out.concentrationPct = r.concentrationPct;
            }
            if (typeof r.chemistryClass === 'string' && r.chemistryClass.trim()) {
              out.chemistryClass = r.chemistryClass.trim().slice(0, 64);
            }
            if (typeof r.iracGroup === 'string' && /^[A-Z0-9]{1,4}$/.test(r.iracGroup)) {
              out.iracGroup = r.iracGroup;
            }
            if (
              typeof r.fracCode === 'string' &&
              /^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/.test(r.fracCode)
            ) {
              out.fracCode = r.fracCode;
            }
            return out;
          })
          .filter((x): x is ScannedActiveIngredient => x !== null)
      : undefined;

  // Phase 17 (Track 2) — formulation block (chem + fertilizer).
  let formulation: ScannedFormulation | undefined;
  if (data.formulation && typeof data.formulation === 'object') {
    const f = data.formulation as Record<string, unknown>;
    const out: ScannedFormulation = {};
    if (typeof f.type === 'string' && f.type.trim()) out.type = f.type.trim().slice(0, 32);
    if (
      f.npk &&
      typeof f.npk === 'object' &&
      typeof (f.npk as { n?: unknown }).n === 'number' &&
      typeof (f.npk as { p?: unknown }).p === 'number' &&
      typeof (f.npk as { k?: unknown }).k === 'number'
    ) {
      const npk = f.npk as { n: number; p: number; k: number };
      if (npk.n >= 0 && npk.n <= 100 && npk.p >= 0 && npk.p <= 100 && npk.k >= 0 && npk.k <= 100) {
        out.npk = { n: npk.n, p: npk.p, k: npk.k };
      }
    }
    if (
      typeof f.productClass === 'string' &&
      ['synthetic', 'organic', 'biocontrol'].includes(f.productClass)
    ) {
      out.productClass = f.productClass as ScannedFormulation['productClass'];
    }
    if (out.type || out.npk || out.productClass) formulation = out;
  }

  return {
    found: true,
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    shortName,
    category: cat,
    defaultUnit: typeof data.defaultUnit === 'string' ? data.defaultUnit : undefined,
    packageQuantity:
      typeof data.packageQuantity === 'number' && data.packageQuantity > 0
        ? data.packageQuantity
        : undefined,
    reorderThreshold: typeof data.reorderThreshold === 'number' ? data.reorderThreshold : undefined,
    notes: typeof data.notes === 'string' && data.notes ? data.notes : undefined,
    seedMeta,
    activeIngredients,
    formulation,
    guessed: Array.isArray(data.guessed)
      ? data.guessed.filter((g: unknown) => typeof g === 'string')
      : [],
    // The raw `type` from the Claude response is exposed via the catch-all
    // `__rawType` field below; the endpoint resolves it against the user's
    // taxonomy before returning a SuggestedType to the client.
    ...(typeof data.type === 'string' && data.type.trim()
      ? { suggestedType: { name: data.type.trim(), isNew: true } satisfies SuggestedType }
      : {})
  };
}

/** Friendly error thrown when Anthropic returns 529 / overloaded after retries.
 *  Endpoints catch this and surface a 503 with a hint to retry. */
export class AnthropicOverloadedError extends Error {
  constructor() {
    super("Anthropic's API is busy right now. Please try again in a moment.");
    this.name = 'AnthropicOverloadedError';
  }
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // The Anthropic SDK exposes the HTTP status as `status` on its API errors;
  // it also includes the upstream error.type for the JSON body.
  const e = err as { status?: number; error?: { error?: { type?: string } } };
  if (e.status === 529 || e.status === 503 || e.status === 429) return true;
  return e.error?.error?.type === 'overloaded_error';
}

function isOverloaded(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; error?: { error?: { type?: string } } };
  return e.status === 529 || e.error?.error?.type === 'overloaded_error';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff for transient Anthropic failures. Throws
 *  the original error after exhausting attempts, or AnthropicOverloadedError
 *  if the final failure was a 529. */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 800;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      // Exponential backoff with light jitter: 800ms, 1.6s, 3.2s, …
      await sleep(baseDelay * Math.pow(2, i) + Math.random() * 250);
    }
  }
  if (isOverloaded(lastErr)) throw new AnthropicOverloadedError();
  throw lastErr;
}

// Claude text-only call (for barcode lookup where we have no image).
export async function claudeTextLookup(
  barcode: string,
  partialName?: string
): Promise<Partial<ScanResult>> {
  const apiKey = getApiKey();
  if (!apiKey) return { found: false };
  try {
    const client = new Anthropic({ apiKey });
    const nameHint = partialName ? ` Partial name from database: "${partialName}".` : '';
    const msg = await withRetry(() =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Identify this farm supply product. Barcode: ${barcode}.${nameHint}`
          }
        ]
      })
    );
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    return parseClaudeJson(text);
  } catch (err) {
    // Surface overload to the endpoint so it can return a friendly message.
    if (err instanceof AnthropicOverloadedError) throw err;
    return { found: false };
  }
}

export interface FetchedPageContent {
  url: string;
  title?: string;
  metaDescription?: string;
  /** og:* + twitter:* + product:* tags as a flat map (last write wins). */
  metaTags: Record<string, string>;
  /** Raw JSON-LD blocks (already parsed + re-serialized for size control). */
  jsonLd: unknown[];
  /** `<select>` dropdowns — variant/size pickers etc. */
  selects: Array<{ name?: string; label?: string; options: string[] }>;
  /** `<table>` rows — most seed-catalog spec sheets live here. */
  tables: string[][][];
  /** Heading hierarchy as `H1: text` / `H2: text` lines. */
  headings: string[];
  /** Definition-list pairs (`<dl>` term/desc). */
  defList: Array<{ term: string; description: string }>;
  /** Plain-text body (block-aware — newlines preserved between paragraphs). */
  bodyText: string;
}

/** Fetch a product page and decompose the HTML into the structured signals
 *  most relevant to filling an inventory record — JSON-LD product schemas,
 *  meta/OG tags, `<select>` variant pickers, `<table>` spec sheets, headings,
 *  and the body text. Seed-catalog and chemical-supply pages put critical
 *  info (pack size, days-to-maturity, active ingredients) in dropdowns and
 *  spec tables, so we surface those separately rather than collapsing
 *  everything into one text run.
 *
 *  Caller is responsible for URL validation. Caps the read at ~2MB, times
 *  out after 12s, and rejects non-HTML content-types. */
export async function fetchPageContent(url: string): Promise<FetchedPageContent> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'CropCard/1.0 (+farm inventory)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000)
    });
  } catch (e) {
    throw new Error(`Could not load page: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`Page returned HTTP ${res.status}`);
  const ctype = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/.test(ctype)) {
    throw new Error(`Unsupported content-type "${ctype || 'unknown'}" — expected HTML`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Empty response body');
  const decoder = new TextDecoder('utf-8');
  let html = '';
  const MAX_BYTES = 2_000_000;
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (bytes >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  html += decoder.decode();

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? cleanInline(titleMatch[1]) : undefined;

  // <meta> — description + og:* / twitter:* / product:*
  const metaTags: Record<string, string> = {};
  let metaDescription: string | undefined;
  const metaRe = /<meta\b([^>]*?)\/?>/gi;
  for (const m of html.matchAll(metaRe)) {
    const attrs = m[1];
    const name = (attrs.match(/\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!name || content == null) continue;
    const key = name.toLowerCase();
    const value = decodeEntities(content).trim();
    if (!value) continue;
    if (key === 'description') metaDescription = value;
    if (
      /^(og:|twitter:|product:|book:|article:)/.test(key) ||
      key === 'keywords' ||
      key === 'description'
    ) {
      metaTags[key] = value;
    }
  }

  // <script type="application/ld+json"> — highest-signal product data
  const jsonLd: unknown[] = [];
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldRe)) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) jsonLd.push(...parsed);
      else jsonLd.push(parsed);
    } catch {
      // Skip malformed JSON-LD silently — vendor pages sometimes include
      // template placeholders that break parse; not worth surfacing.
    }
    if (jsonLd.length >= 20) break;
  }

  // <select> dropdowns — variant pickers (pack size, treatment, etc.).
  const selects: FetchedPageContent['selects'] = [];
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  for (const m of html.matchAll(selectRe)) {
    const attrs = m[1];
    const inner = m[2];
    const name = (attrs.match(/\b(?:name|id)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const ariaLabel = (attrs.match(/\baria-label\s*=\s*["']([^"']+)["']/i) || [])[1];
    const dataLabel = (attrs.match(/\bdata-(?:label|title)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const label = ariaLabel || dataLabel || undefined;
    const options: string[] = [];
    const optionRe = /<option\b[^>]*>([\s\S]*?)<\/option>/gi;
    for (const o of inner.matchAll(optionRe)) {
      const text = cleanInline(o[1]);
      if (text && text.length <= 200) options.push(text);
      if (options.length >= 50) break;
    }
    if (options.length > 0) selects.push({ name, label, options });
    if (selects.length >= 20) break;
  }

  // <table> — spec sheets and growing-info tables.
  const tables: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (const m of html.matchAll(tableRe)) {
    const rows: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const r of m[1].matchAll(rowRe)) {
      const cells: string[] = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      for (const c of r[1].matchAll(cellRe)) {
        const text = cleanInline(c[1]);
        cells.push(text);
      }
      if (cells.some((c) => c)) rows.push(cells);
      if (rows.length >= 50) break;
    }
    if (rows.length > 0) tables.push(rows);
    if (tables.length >= 10) break;
  }

  // Heading hierarchy.
  const headings: string[] = [];
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const m of html.matchAll(headingRe)) {
    const text = cleanInline(m[2]);
    if (text) headings.push(`H${m[1]}: ${text}`);
    if (headings.length >= 40) break;
  }

  // <dl> definition lists — many seed pages stick growing info here.
  const defList: FetchedPageContent['defList'] = [];
  const dlRe = /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi;
  for (const m of html.matchAll(dlRe)) {
    const inner = m[1];
    const pairRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    for (const p of inner.matchAll(pairRe)) {
      const term = cleanInline(p[1]);
      const description = cleanInline(p[2]);
      if (term && description) defList.push({ term, description });
      if (defList.length >= 40) break;
    }
    if (defList.length >= 40) break;
  }

  // Block-aware plain text — preserve paragraph breaks so growing
  // instructions don't collapse into one wall.
  const bodyText = htmlToBlockText(html).slice(0, 18_000);

  return {
    url,
    title,
    metaDescription,
    metaTags,
    jsonLd,
    selects,
    tables,
    headings,
    defList,
    bodyText
  };
}

/** Strip an inline HTML fragment to a single-line text value. */
function cleanInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reduce a full HTML document to plain text while preserving block-level
 *  newlines so paragraphs, list items, and table cells stay legible. */
function htmlToBlockText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(p|div|li|h[1-6]|tr|section|article|header|footer|nav|aside|blockquote|pre)>/gi,
        '\n'
      )
      .replace(/<\/td>/gi, '\t')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Render a FetchedPageContent into clearly delimited sections so Claude can
 *  prioritize JSON-LD + selects + tables over noisy body copy. The total is
 *  budgeted around 24KB; JSON-LD and structured sections always survive,
 *  bodyText is the truncation target. */
export function renderPageContentForPrompt(p: FetchedPageContent): string {
  const parts: string[] = [];
  parts.push(`URL: ${p.url}`);
  if (p.title) parts.push(`TITLE: ${p.title}`);
  if (p.metaDescription) parts.push(`META DESCRIPTION: ${p.metaDescription}`);
  const ogKeys = Object.keys(p.metaTags).filter((k) => k !== 'description');
  if (ogKeys.length > 0) {
    const ogLines = ogKeys.slice(0, 25).map((k) => `  ${k}: ${truncate(p.metaTags[k], 300)}`);
    parts.push(`META TAGS:\n${ogLines.join('\n')}`);
  }
  if (p.jsonLd.length > 0) {
    const lines: string[] = [];
    let used = 0;
    for (let i = 0; i < p.jsonLd.length && used < 8000; i++) {
      const blob = JSON.stringify(p.jsonLd[i]);
      const trimmed = blob.length > 4000 ? blob.slice(0, 4000) + '…' : blob;
      lines.push(`  [${i + 1}] ${trimmed}`);
      used += trimmed.length;
    }
    parts.push(`JSON-LD (schema.org structured data):\n${lines.join('\n')}`);
  }
  if (p.selects.length > 0) {
    const lines = p.selects.map((s, i) => {
      const head = `  SELECT #${i + 1}${s.name ? ` name="${s.name}"` : ''}${s.label ? ` label="${s.label}"` : ''}:`;
      const opts = s.options.map((o) => `    - ${truncate(o, 200)}`).join('\n');
      return `${head}\n${opts}`;
    });
    parts.push(`DROPDOWNS / VARIANTS:\n${lines.join('\n')}`);
  }
  if (p.tables.length > 0) {
    const lines = p.tables.map((rows, i) => {
      const rendered = rows
        .slice(0, 30)
        .map((cells) => `    | ${cells.map((c) => truncate(c, 120)).join(' | ')} |`)
        .join('\n');
      return `  TABLE #${i + 1}:\n${rendered}`;
    });
    parts.push(`TABLES:\n${lines.join('\n\n')}`);
  }
  if (p.defList.length > 0) {
    const lines = p.defList
      .slice(0, 40)
      .map((d) => `  ${truncate(d.term, 80)} :: ${truncate(d.description, 240)}`);
    parts.push(`DEFINITION LIST:\n${lines.join('\n')}`);
  }
  if (p.headings.length > 0) {
    parts.push(`HEADINGS:\n${p.headings.map((h) => `  ${h}`).join('\n')}`);
  }
  if (p.bodyText) parts.push(`BODY TEXT:\n${p.bodyText}`);
  return parts.join('\n\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Claude text call seeded with a product URL's structured page content.
 *  Used by /api/scan-url to fill the Add-item form from a seed-catalog or
 *  chemical-supply product page. The prompt surfaces JSON-LD, dropdowns,
 *  tables, and headings as separate labeled sections so the model can read
 *  pack sizes from the SELECT and DTM from the spec table instead of
 *  hunting through prose. */
export async function claudeUrlLookup(content: FetchedPageContent): Promise<Partial<ScanResult>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key configured. Add it on the Settings page.');
  const client = new Anthropic({ apiKey });
  const rendered = renderPageContentForPrompt(content);
  const userMessage =
    `Identify this farm-supply product from a vendor product page. The page has been ` +
    `parsed into labeled sections. Treat JSON-LD and TABLES as authoritative; DROPDOWNS ` +
    `enumerate available pack-size / variant choices and reveal the canonical "packageQuantity" ` +
    `you should pick (prefer the smallest practical pack — e.g., "Packet" for seeds, the most ` +
    `commonly stocked container for chems). When multiple variants appear, return one product ` +
    `record using the smallest pack and note the others in "notes".\n\n` +
    `${rendered}\n\n` +
    `Return the structured JSON. Add any field you inferred rather than read directly from ` +
    `the page to "guessed". If the page is clearly NOT a single product page (a category list, ` +
    `a home page, an error page), return {"found": false}.`;
  const msg = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  );
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return parseClaudeJson(text);
}

// Claude vision call (for label photo).
export async function claudeVisionLookup(
  base64jpeg: string,
  barcode?: string
): Promise<Partial<ScanResult>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key configured. Add it on the Settings page.');
  const client = new Anthropic({ apiKey });
  const barcodeHint = barcode ? ` The product barcode is ${barcode}.` : '';
  const msg = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64jpeg }
            },
            {
              type: 'text',
              text: `Read this farm supply product label and return the structured JSON.${barcodeHint}`
            }
          ]
        }
      ]
    })
  );
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return parseClaudeJson(text);
}
