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
  source: 'openfoodfacts' | 'claude' | 'claude-vision' | 'none';
  barcode?: string;
  existingStockItemId?: string;
  cropPluginMatches?: CropPluginMatch[];
  /** Type suggestion the UI displays for confirmation (mapped or new). */
  suggestedType?: SuggestedType;
}

export const STOCK_CATEGORIES = [
  'herbicide', 'insecticide', 'fungicide', 'fertilizer',
  'seed', 'adjuvant', 'fuel', 'part'
] as const;

// Matches a token-overlap fuzzy score ≥ 0.3 against all crop plugins.
export async function matchCropPlugins(displayName: string): Promise<CropPluginMatch[]> {
  try {
    const registry = await getRegistry();
    const tokA = new Set(displayName.toLowerCase().split(/\W+/).filter(Boolean));
    return registry.crops()
      .map((p) => {
        const tokB = new Set(p.displayName.toLowerCase().split(/\W+/).filter(Boolean));
        let shared = 0;
        for (const t of tokA) { if (tokB.has(t)) shared++; }
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
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  const data = JSON.parse(cleaned);
  if (data.found === false) return { found: false };

  const cat = STOCK_CATEGORIES.includes(data.category) ? data.category as StockCategory : undefined;
  const seedMeta: SeedMeta | undefined = cat === 'seed' && data.seedMeta
    ? {
        daysToMaturity: typeof data.seedMeta.daysToMaturity === 'number' ? data.seedMeta.daysToMaturity : undefined,
        plantingTempMinF: typeof data.seedMeta.plantingTempMinF === 'number' ? data.seedMeta.plantingTempMinF : undefined,
        plantingTempMaxF: typeof data.seedMeta.plantingTempMaxF === 'number' ? data.seedMeta.plantingTempMaxF : undefined,
        spacingInches: typeof data.seedMeta.spacingInches === 'number' ? data.seedMeta.spacingInches : undefined,
        depthInches: typeof data.seedMeta.depthInches === 'number' ? data.seedMeta.depthInches : undefined,
        sunRequirement: ['full-sun','partial-shade','full-shade'].includes(data.seedMeta.sunRequirement) ? data.seedMeta.sunRequirement : undefined,
        seedsPerPacket: typeof data.seedMeta.seedsPerPacket === 'number' ? data.seedMeta.seedsPerPacket : undefined,
      }
    : undefined;

  const shortNameRaw = typeof data.shortName === 'string' ? data.shortName.trim() : '';
  const shortName =
    shortNameRaw && shortNameRaw.length > 0 && shortNameRaw.length <= 40 && !/[\x00-\x1f]/.test(shortNameRaw)
      ? shortNameRaw
      : undefined;

  // Phase 17 (Track 2) — active ingredients (chem products only).
  const activeIngredients: ScannedActiveIngredient[] | undefined =
    Array.isArray(data.activeIngredients) && (cat === 'herbicide' || cat === 'insecticide' || cat === 'fungicide')
      ? (data.activeIngredients as unknown[])
          .map((raw): ScannedActiveIngredient | null => {
            if (!raw || typeof raw !== 'object') return null;
            const r = raw as Record<string, unknown>;
            if (typeof r.name !== 'string' || !r.name.trim()) return null;
            const out: ScannedActiveIngredient = { name: r.name.trim().slice(0, 120) };
            if (typeof r.concentrationPct === 'number' && r.concentrationPct > 0 && r.concentrationPct <= 100) {
              out.concentrationPct = r.concentrationPct;
            }
            if (typeof r.chemistryClass === 'string' && r.chemistryClass.trim()) {
              out.chemistryClass = r.chemistryClass.trim().slice(0, 64);
            }
            if (typeof r.iracGroup === 'string' && /^[A-Z0-9]{1,4}$/.test(r.iracGroup)) {
              out.iracGroup = r.iracGroup;
            }
            if (typeof r.fracCode === 'string' && /^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/.test(r.fracCode)) {
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
    guessed: Array.isArray(data.guessed) ? data.guessed.filter((g: unknown) => typeof g === 'string') : [],
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
export async function claudeTextLookup(barcode: string, partialName?: string): Promise<Partial<ScanResult>> {
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
        messages: [{
          role: 'user',
          content: `Identify this farm supply product. Barcode: ${barcode}.${nameHint}`
        }]
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

// Claude vision call (for label photo).
export async function claudeVisionLookup(base64jpeg: string, barcode?: string): Promise<Partial<ScanResult>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key configured. Add it on the Settings page.');
  const client = new Anthropic({ apiKey });
  const barcodeHint = barcode ? ` The product barcode is ${barcode}.` : '';
  const msg = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64jpeg } },
          { type: 'text', text: `Read this farm supply product label and return the structured JSON.${barcodeHint}` }
        ]
      }]
    })
  );
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return parseClaudeJson(text);
}
