import Anthropic from '@anthropic-ai/sdk';
import { selectModel, estimateUsd, type AiResultMeta } from './aiPlanning';
import { extractJsonObject } from './aiJsonExtract';
import { getApiKey } from './scanResult';
import {
  formatDay,
  isValidWindow,
  type FrostDatesIso,
  type PlantingWindow
} from '$lib/plan/plantingWindow';

const MAX_NOTE_CHARS = 140;

export interface PlantingWindowPromptInput {
  cropPluginId: string;
  cropName: string;
  cropFamily: string | null;
  dtmMaxDays: number | null;
  soilTempMinF: number | null;
  year: number;
  frost: FrostDatesIso;
  /** Null when the owner never saved coordinates; the prompt then leans on
   *  the frost dates alone instead of a guessed location. */
  latLon: { lat: number; lon: number } | null;
  baseline: PlantingWindow;
}

export interface PlantingWindowAiResult {
  window: PlantingWindow;
  meta: AiResultMeta;
}

export function buildPlantingWindowPrompt(input: PlantingWindowPromptInput): string {
  const where = input.latLon
    ? `Farm location: ${input.latLon.lat.toFixed(2)}, ${input.latLon.lon.toFixed(2)} (lat, lon).`
    : 'Farm location: not set; rely on the frost dates.';
  const y = String(input.year);
  const crosses = !input.frost.lastSpring.startsWith(y) || !input.frost.firstFall.startsWith(y);
  return [
    `Give planting dates for ${input.cropName} on a small farm in ${input.year}.`,
    where,
    `Average last spring frost: ${formatDay(input.frost.lastSpring)}. First fall frost: ${formatDay(input.frost.firstFall)}.`,
    `Crop family: ${input.cropFamily ?? 'unknown'}. Days to maturity (max): ${input.dtmMaxDays ?? 'unknown'}. Min soil temp: ${input.soilTempMinF != null ? `${input.soilTempMinF}°F` : 'unknown'}.`,
    `A frost-date rule of thumb gives earliest ${input.baseline.earliest}, prime ${input.baseline.prime}, latest ${input.baseline.latest}. Adjust for this location and crop.`,
    '',
    'Rules:',
    '- Dates are for putting the crop in this block (direct seed or transplant, whichever is usual here).',
    crosses
      ? `- This season runs across the new year (last spring frost ${input.frost.lastSpring}, first fall frost ${input.frost.firstFall}). Dates fall in that season, formatted YYYY-MM-DD, with earliest <= prime <= latest.`
      : `- All dates in ${input.year}, formatted YYYY-MM-DD, with earliest <= prime <= latest.`,
    '- Fall-planted crops (garlic, winter grains, cover crops) use the fall window.',
    '- "latest" still lets the crop mature or establish before it matters (frost, winter).',
    `- note: one plain sentence under ${MAX_NOTE_CHARS} characters on the key local factor. No hedging.`,
    '',
    'Return JSON only: { "earliest": "YYYY-MM-DD", "prime": "YYYY-MM-DD", "latest": "YYYY-MM-DD", "note": "..." }'
  ].join('\n');
}

export function sanitizeNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.replace(/\p{Cc}/gu, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_NOTE_CHARS ? `${trimmed.slice(0, MAX_NOTE_CHARS - 1)}…` : trimmed;
}

/** Throws on anything unusable so `tryAiWithGuard` degrades to the
 *  frost-date window. */
export function parsePlantingWindowResponse(
  text: string,
  year: number,
  frost?: FrostDatesIso
): PlantingWindow {
  const raw = extractJsonObject(text) as Record<string, unknown> | null;
  const candidate = raw
    ? { earliest: raw.earliest, prime: raw.prime, latest: raw.latest, note: sanitizeNote(raw.note) }
    : null;
  if (!isValidWindow(candidate, year, frost)) throw new Error('invalid planting window');
  return candidate;
}

export async function suggestPlantingWindow(
  input: PlantingWindowPromptInput,
  signal?: AbortSignal
): Promise<PlantingWindowAiResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('plantingWindow');
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: 400,
      messages: [{ role: 'user', content: buildPlantingWindowPrompt(input) }]
    },
    { signal }
  );
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
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
  return { window: parsePlantingWindowResponse(text, input.year, input.frost), meta };
}

const CACHE_TTL_MS = 7 * 86_400_000;
const CACHE_MAX = 500;
const cache = new Map<string, { window: PlantingWindow; at: number }>();

export function plantingWindowCacheKey(ownerId: string, input: PlantingWindowPromptInput): string {
  const loc = input.latLon ? `${input.latLon.lat.toFixed(2)},${input.latLon.lon.toFixed(2)}` : '-';
  return [
    ownerId,
    input.cropPluginId,
    input.year,
    loc,
    input.frost.lastSpring,
    input.frost.firstFall
  ].join('|');
}

export function getCachedWindow(key: string, now = Date.now()): PlantingWindow | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.window;
}

export function setCachedWindow(key: string, window: PlantingWindow, now = Date.now()): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { window, at: now });
}

export function clearPlantingWindowCache(): void {
  cache.clear();
}
