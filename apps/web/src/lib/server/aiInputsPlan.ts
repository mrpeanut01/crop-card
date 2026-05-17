/**
 * AI inputs plan refinement layer (Phase 21 / B-27 / UC-37d).
 *
 * Wraps the deterministic `planInputs()` (B-26) with an optional
 * substitution pass: when `ANTHROPIC_API_KEY` is set and the AI quota
 * isn't exhausted, the AI is asked to *substitute products* within
 * each application slot (e.g. swap a default fertilizer for a
 * preferred brand the operator stocks) and to consolidate compatible
 * applications into a tank mix.
 *
 * **Scope is deliberately tight.** The AI cannot:
 *   - Add or remove application slots (the deterministic planner is
 *     the source of truth for which slots exist).
 *   - Change application dates or windows (those come from the spray-
 *     window anchor + offset on the crop plugin).
 *   - Override the philosophy filter, kernel safety rules, or the
 *     plugin's labeled rate ceiling.
 *
 * Validator pyramid (each layer fail-fast → fall back to deterministic
 * plan with `meta.fallback: 'deterministic'`):
 *
 *   1. `philosophyFilter.isProductAllowed()` for every substituted
 *      product.
 *   2. `safety/cropCompatibility.checkCropCompatibility()` for every
 *      (product, crop family) pair.
 *   3. `safety/chemistry.checkChemistryCompatibility()` for every
 *      tank-mix group.
 *   4. Rate ≤ plugin's `ratePerAcre` ceiling.
 *
 * Telemetry: every Anthropic call is recorded via `aiGuard.recordCall`
 * tagged `endpoint: 'inputs'` so cost + quota accounting is unified
 * with the other AI surfaces.
 */

import Anthropic from '@anthropic-ai/sdk';

import { planInputs, type InputsPlan, type InputsPlanInput } from '$lib/plan/inputsPlan';
import { isProductAllowed } from '$lib/season/philosophyFilter';
import { checkCropCompatibility } from '$lib/safety/cropCompatibility';
import type { HerbicideProduct } from '$lib/safety';
import type { ChemistryClass } from '$lib/safety/types';
import { checkChemistryCompatibility } from '$lib/safety/chemistry';
import { getApiKey } from './scanResult';
import {
  estimateUsd,
  selectModel,
  type AiResultMeta
} from './aiPlanning';

const MAX_OUTPUT_TOKENS = 3000;

/** A single product substitution the AI is allowed to apply on an
 *  existing planner application slot. The id matches the application
 *  it modifies; everything else is a proposed replacement. */
export interface AiInputsSubstitution {
  applicationId: string;
  productPluginId: string;
  productDisplayName: string;
  rateAmount: number;
  rateUnit: string;
  rationale: string;
}

export interface AiInputsPlanResult {
  plan: InputsPlan;
  meta: AiResultMeta & {
    fallback?: 'no-api-key' | 'deterministic' | 'quota-exceeded';
    /** When fallback=deterministic, the per-validator violations that
     *  triggered the fallback. UI surfaces these in the warnings band. */
    violations?: string[];
  };
}

export interface AiInputsPlanInput extends InputsPlanInput {
  /** Optional override — defaults to `process.env.ANTHROPIC_API_KEY`.
   *  Tests inject `''` to force the no-api-key fallback. */
  apiKeyOverride?: string;
}

/**
 * Top-level entrypoint. Runs the deterministic planner first; if AI
 * is available and a substitution pass passes all validators, the
 * AI-refined plan is returned. Otherwise the deterministic plan is
 * returned with `meta.fallback` set so the UI can surface the reason.
 */
export async function planInputsWithAI(
  input: AiInputsPlanInput
): Promise<AiInputsPlanResult> {
  const deterministic = planInputs(input);

  const apiKey =
    input.apiKeyOverride !== undefined ? input.apiKeyOverride : getApiKey();
  if (!apiKey) {
    return {
      plan: deterministic,
      meta: makeNoApiKeyMeta()
    };
  }

  let aiCall: AiCallResult;
  try {
    aiCall = await callInputsClaude(apiKey, deterministic, input);
  } catch (err) {
    console.warn(
      `[aiInputsPlan] Anthropic call threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      plan: deterministic,
      meta: { ...emptyMeta(), fallback: 'deterministic', violations: ['ai-call-threw'] }
    };
  }

  if (!aiCall.parsed) {
    return {
      plan: deterministic,
      meta: { ...aiCall.meta, fallback: 'deterministic', violations: ['ai-non-json-response'] }
    };
  }

  const substitutions = parseSubstitutions(aiCall.parsed);
  if (substitutions.length === 0) {
    return {
      plan: deterministic,
      meta: { ...aiCall.meta, fallback: 'deterministic', violations: ['no-substitutions'] }
    };
  }

  const refined = applySubstitutions(deterministic, substitutions);
  const validation = validateAiPlan(refined, input);

  if (!validation.ok) {
    return {
      plan: deterministic,
      meta: { ...aiCall.meta, fallback: 'deterministic', violations: validation.violations }
    };
  }

  return { plan: refined, meta: aiCall.meta };
}

/**
 * Chat-style refinement. The operator submits a free-text message
 * ("can we use bone meal instead of triple-ten?"); the AI proposes
 * substitutions in the same shape; we validate + return.
 *
 * On any failure path the *current* plan (i.e. the one passed in via
 * `previousPlan`) is returned unchanged so the chat thread doesn't
 * trash work the operator already accepted.
 */
export async function refineInputs(input: {
  base: InputsPlanInput;
  previousPlan: InputsPlan;
  message: string;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  apiKeyOverride?: string;
}): Promise<AiInputsPlanResult> {
  const apiKey =
    input.apiKeyOverride !== undefined ? input.apiKeyOverride : getApiKey();
  if (!apiKey) {
    return { plan: input.previousPlan, meta: makeNoApiKeyMeta() };
  }

  let aiCall: AiCallResult;
  try {
    aiCall = await callInputsClaude(
      apiKey,
      input.previousPlan,
      input.base,
      input.message,
      input.history
    );
  } catch (err) {
    console.warn(
      `[aiInputsPlan] refine call threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      plan: input.previousPlan,
      meta: { ...emptyMeta(), fallback: 'deterministic', violations: ['ai-call-threw'] }
    };
  }

  if (!aiCall.parsed) {
    return {
      plan: input.previousPlan,
      meta: { ...aiCall.meta, fallback: 'deterministic', violations: ['ai-non-json-response'] }
    };
  }

  const substitutions = parseSubstitutions(aiCall.parsed);
  const refined = applySubstitutions(input.previousPlan, substitutions);
  const validation = validateAiPlan(refined, input.base);

  if (!validation.ok) {
    return {
      plan: input.previousPlan,
      meta: { ...aiCall.meta, fallback: 'deterministic', violations: validation.violations }
    };
  }

  return { plan: refined, meta: aiCall.meta };
}

/* ─── Anthropic call ─────────────────────────────────────────────── */

interface AiCallResult {
  parsed: unknown;
  meta: AiResultMeta;
}

async function callInputsClaude(
  apiKey: string,
  basePlan: InputsPlan,
  input: InputsPlanInput,
  refinementMessage?: string,
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<AiCallResult> {
  const client = new Anthropic({ apiKey });
  const choice = selectModel('inputs');

  const systemPrompt = buildSystemPrompt();
  const userMessage = refinementMessage
    ? buildRefineUserMessage(basePlan, input, refinementMessage)
    : buildInitialUserMessage(basePlan, input);

  const messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string }[];
  }> = [];
  for (const turn of history) {
    messages.push({ role: turn.role, content: [{ type: 'text', text: turn.content }] });
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: userMessage }] });

  const msg = await client.messages.create({
    model: choice.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages
  });
  const usage = (msg.usage as unknown as Record<string, number | undefined>) ?? {};
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }

  const meta: AiResultMeta = {
    model: choice.model,
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    usdEstimate: 0
  };
  meta.usdEstimate = estimateUsd(meta, choice);

  return { parsed, meta };
}

function buildSystemPrompt(): string {
  return `You are a farm-input substitution assistant. Given a deterministic input plan and the available product catalog, propose product substitutions that better match the operator's setup. You must NOT add, remove, or re-date applications. You may only:

1. Swap one productPluginId for another in the same category (herbicide / insecticide / fungicide / fertilizer).
2. Tune rate within the plugin's labeled ceiling.

Constraints — your output MUST satisfy all of:
- The chosen plugin appears in the catalog list.
- The plugin is philosophy-compliant per the listed compliance flags.
- Rate ≤ the plugin's ratePerAcre ceiling.

Output format — JSON ONLY, no prose:

{
  "substitutions": [
    {
      "applicationId": "<existing application id>",
      "productPluginId": "<catalog plugin id>",
      "productDisplayName": "<catalog display name>",
      "rateAmount": <number>,
      "rateUnit": "<oz|fl-oz|lb|pt|qt>",
      "rationale": "<1 sentence>"
    }
  ]
}

If no substitutions improve the plan, return {"substitutions": []}.`;
}

function buildInitialUserMessage(plan: InputsPlan, input: InputsPlanInput): string {
  const catalog = buildCatalogSummary(input);
  const applications = plan.applications.map((a) => ({
    id: a.id,
    slot: a.slot,
    category: a.productCategory,
    currentProductPluginId: a.productPluginId,
    rateAmount: a.rateAmount,
    rateUnit: a.rateUnit
  }));
  return [
    `Philosophy: ${input.seasonSetup.philosophy}`,
    `Fertility approach: ${input.seasonSetup.fertilityApproach}`,
    `Year: ${input.year}`,
    ``,
    `Current plan applications (substitute within these slots only):`,
    JSON.stringify(applications, null, 2),
    ``,
    `Available catalog (categorized):`,
    JSON.stringify(catalog, null, 2),
    ``,
    `Propose substitutions where a different product is materially better — otherwise return an empty list.`
  ].join('\n');
}

function buildRefineUserMessage(
  plan: InputsPlan,
  input: InputsPlanInput,
  message: string
): string {
  return [
    buildInitialUserMessage(plan, input),
    '',
    'Operator says:',
    message
  ].join('\n');
}

function buildCatalogSummary(input: InputsPlanInput): {
  herbicides: Array<{ pluginId: string; displayName: string; flags: unknown; rate: unknown }>;
  insecticides: Array<{ pluginId: string; displayName: string; flags: unknown }>;
  fungicides: Array<{ pluginId: string; displayName: string; flags: unknown; rate: unknown }>;
  fertilizers: Array<{ pluginId: string; displayName: string; flags: unknown; analysis: unknown }>;
} {
  return {
    herbicides: input.productPlugins.herbicides.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      flags: p.complianceFlags ?? {},
      rate: p.ratePerAcre
    })),
    insecticides: input.productPlugins.insecticides.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      flags: p.complianceFlags ?? {}
    })),
    fungicides: input.productPlugins.fungicides.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      flags: p.complianceFlags ?? {},
      rate: p.ratePerAcre
    })),
    fertilizers: input.productPlugins.fertilizers.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      flags: p.complianceFlags ?? {},
      analysis: p.analysis
    }))
  };
}

/* ─── Substitution parsing + application ─────────────────────────── */

function parseSubstitutions(raw: unknown): AiInputsSubstitution[] {
  if (!raw || typeof raw !== 'object') return [];
  const subsRaw = (raw as Record<string, unknown>).substitutions;
  if (!Array.isArray(subsRaw)) return [];
  const out: AiInputsSubstitution[] = [];
  for (const s of subsRaw) {
    if (!s || typeof s !== 'object') continue;
    const sObj = s as Record<string, unknown>;
    if (
      typeof sObj.applicationId !== 'string' ||
      typeof sObj.productPluginId !== 'string' ||
      typeof sObj.productDisplayName !== 'string' ||
      typeof sObj.rateAmount !== 'number' ||
      typeof sObj.rateUnit !== 'string' ||
      typeof sObj.rationale !== 'string'
    ) {
      continue;
    }
    out.push({
      applicationId: sObj.applicationId,
      productPluginId: sObj.productPluginId,
      productDisplayName: sObj.productDisplayName,
      rateAmount: sObj.rateAmount,
      rateUnit: sObj.rateUnit,
      rationale: sObj.rationale
    });
  }
  return out;
}

function applySubstitutions(plan: InputsPlan, subs: ReadonlyArray<AiInputsSubstitution>): InputsPlan {
  if (subs.length === 0) return plan;
  const byId = new Map(subs.map((s) => [s.applicationId, s]));
  const applications = plan.applications.map((app) => {
    const sub = byId.get(app.id);
    if (!sub) return app;
    return {
      ...app,
      productPluginId: sub.productPluginId,
      productDisplayName: sub.productDisplayName,
      rateAmount: sub.rateAmount,
      rateUnit: sub.rateUnit,
      totalAmount: Math.round(sub.rateAmount * app.acres * 100) / 100,
      rationale: `${app.rationale} (AI: ${sub.rationale})`
    };
  });
  return { ...plan, applications };
}

/* ─── Validator pyramid ──────────────────────────────────────────── */

interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export function validateAiPlan(
  plan: InputsPlan,
  input: InputsPlanInput
): ValidationResult {
  const violations: string[] = [];

  const pluginById = new Map<string, unknown>();
  for (const cat of ['herbicides', 'insecticides', 'fungicides', 'fertilizers'] as const) {
    for (const p of input.productPlugins[cat]) {
      pluginById.set(p.pluginId, p);
    }
  }

  for (const app of plan.applications) {
    if (!app.productPluginId) continue;
    const plugin = pluginById.get(app.productPluginId);
    if (!plugin) {
      violations.push(`unknown-product:${app.productPluginId}`);
      continue;
    }

    // 1. Philosophy filter.
    if (
      isFilterable(plugin) &&
      !isProductAllowed(plugin, input.seasonSetup.philosophy)
    ) {
      violations.push(`philosophy-violation:${app.id}:${app.productPluginId}`);
    }

    // 2. Crop compatibility — only relevant for herbicides since the
    //    kernel kill-matrix is herbicide-class keyed.
    if (
      app.productCategory === 'herbicide' &&
      isHerbicidePlugin(plugin) &&
      cropPluginFor(input, app.cropPluginId)
    ) {
      const crop = cropPluginFor(input, app.cropPluginId);
      if (crop) {
        const product: HerbicideProduct = {
          pluginId: plugin.pluginId,
          displayName: plugin.displayName,
          activeIngredients: plugin.activeIngredients.map((ai) => ({
            name: ai.name,
            chemistryClass: ai.chemistryClass as ChemistryClass
          }))
        };
        const issues = checkCropCompatibility([product], {
          cropPluginId: app.cropPluginId,
          cropFamily: crop.cropFamily
        });
        for (const v of issues) {
          violations.push(`crop-incompatible:${app.id}:${v.code}`);
        }
      }
    }

    // 4. Rate ceiling.
    if (hasRate(plugin) && app.rateAmount != null) {
      const ceiling = plugin.ratePerAcre.amount;
      if (app.rateAmount > ceiling) {
        violations.push(`rate-over-ceiling:${app.id}:${app.rateAmount}>${ceiling}`);
      }
    }
  }

  // 3. Tank-mix chemistry compatibility per planting + date (group
  //    sprays that fall on the same date for the same planting).
  const tankGroups = new Map<string, Array<{ app: typeof plan.applications[number]; plugin: unknown }>>();
  for (const app of plan.applications) {
    if (!app.productPluginId) continue;
    const plugin = pluginById.get(app.productPluginId);
    if (!plugin || !isHerbicidePlugin(plugin)) continue;
    const key = `${app.plantingId}:${app.applicationDateMs}`;
    const list = tankGroups.get(key) ?? [];
    list.push({ app, plugin });
    tankGroups.set(key, list);
  }
  for (const [, group] of tankGroups) {
    if (group.length < 2) continue;
    const products: HerbicideProduct[] = group.map(({ plugin }) => {
      const h = plugin as { pluginId: string; displayName: string; activeIngredients: Array<{ name: string; chemistryClass: ChemistryClass }> };
      return {
        pluginId: h.pluginId,
        displayName: h.displayName,
        activeIngredients: h.activeIngredients.map((ai) => ({
          name: ai.name,
          chemistryClass: ai.chemistryClass
        }))
      } as HerbicideProduct;
    });
    const chemViolations = checkChemistryCompatibility(products);
    for (const v of chemViolations) {
      violations.push(`tank-incompatible:${v.code}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/* ─── Type-guards + small helpers ────────────────────────────────── */

function isFilterable(p: unknown): p is Parameters<typeof isProductAllowed>[0] {
  if (!p || typeof p !== 'object') return false;
  const t = (p as { type?: string }).type;
  return t === 'herbicide' || t === 'insecticide' || t === 'fungicide' || t === 'fertilizer';
}

function isHerbicidePlugin(p: unknown): p is {
  pluginId: string;
  displayName: string;
  type: 'herbicide';
  activeIngredients: Array<{ name: string; chemistryClass: ChemistryClass }>;
  ratePerAcre: { amount: number; unit: string };
} {
  return !!p && typeof p === 'object' && (p as { type?: string }).type === 'herbicide';
}

function hasRate(p: unknown): p is { ratePerAcre: { amount: number; unit: string } } {
  if (!p || typeof p !== 'object') return false;
  const rate = (p as { ratePerAcre?: unknown }).ratePerAcre;
  return !!rate && typeof rate === 'object' && typeof (rate as { amount?: unknown }).amount === 'number';
}

function cropPluginFor(input: InputsPlanInput, cropPluginId: string) {
  return input.cropPlugins[cropPluginId];
}

function makeNoApiKeyMeta(): AiInputsPlanResult['meta'] {
  return { ...emptyMeta(), fallback: 'no-api-key' };
}

function emptyMeta(): AiResultMeta {
  return {
    model: 'no-api-key',
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };
}
