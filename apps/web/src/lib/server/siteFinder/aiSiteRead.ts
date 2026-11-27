/** Claude's reading of one USDA NAIP aerial photo for Find a spot (38D).
 *  `run.ts` calls this through `tryAiWithGuard` (aiTry + aiGuard). The answer
 *  is strict JSON, checked by `parseAiReading` before anyone sees it; an
 *  answer that fails the check is thrown as spent so the call still counts
 *  against the farm's budget, and the finder falls back (P-7). */

import { AiSpentError } from '$lib/server/aiCost';
import { anthropicClient } from '$lib/server/anthropicClient';
import { estimateUsd, maxTokensFor, selectModel, type AiResultMeta } from '$lib/server/aiPlanning';
import { getApiKey } from '$lib/server/scanResult';
import { SITE_FINDER_FIXTURE_MARKER } from '$lib/server/aiFixture/siteFinder';
import {
  AI_FEATURE_KINDS,
  MAX_AI_CAVEATS,
  MAX_AI_FEATURES,
  MAX_AI_NOTE,
  MAX_AI_REASON,
  MAX_AI_SPOTS,
  parseAiReading,
  type AiReading,
  type AiReadingRefusal
} from '$lib/siteFinder/aiAnswer';
import type { Footprint, PlantingGoal } from '$lib/siteFinder/types';

export interface SiteReadPromptInput {
  goal: PlantingGoal;
  footprint: Footprint;
  /** Ground width of the photo in feet. */
  photoWidthFt: number;
}

const GOAL_WORDS: Record<PlantingGoal, string> = {
  'vegetable-garden': 'a vegetable garden',
  'herb-garden': 'a small herb garden',
  'flower-garden': 'a flower garden',
  'raised-beds': 'raised garden beds',
  'fruit-trees': 'fruit trees',
  'berry-patch': 'a berry patch',
  'row-crop-field': 'a field for row crops'
};

export function buildSiteReadPrompt(input: SiteReadPromptInput): string {
  const width = Math.max(1, Math.round(input.photoWidthFt));
  const share = (ft: number) => Math.min(1, ft / width).toFixed(3);
  return [
    `This is a USDA NAIP aerial photo of part of someone's property. They want to find a place for ${GOAL_WORDS[input.goal]}.`,
    `North is up. The photo is square and shows ground about ${width} feet wide. It can be a few years old.`,
    `The plot they want is about ${Math.round(input.footprint.widthFt)} feet east to west by ${Math.round(input.footprint.lengthFt)} feet north to south: about ${share(input.footprint.widthFt)} of the photo's width by ${share(input.footprint.lengthFt)} of its height.`,
    '',
    'List what you can see that matters for choosing a spot, and up to three places that look open enough for the plot.',
    '',
    'Rules:',
    '- Answer with one JSON object and nothing else. No prose, no markdown, no code fence. Exactly this shape:',
    '  {"features": [{"kind": "tree", "x": 0.5, "y": 0.4, "radius": 0.05, "note": "..."}], "spots": [{"x": 0.3, "y": 0.6, "reason": "..."}], "caveats": "..."}',
    `- "features" is 0 to ${MAX_AI_FEATURES} things you can see. "kind" is one of: ${AI_FEATURE_KINDS.map((k) => `"${k}"`).join(', ')}.`,
    '- "x" and "y" are 0 to 1 of the photo\'s width and height from the top left corner. "radius" is 0 to 0.5 of the photo\'s width. For a long thing such as a line of trees or a driveway, give "x2" and "y2" for its other end instead of a radius.',
    `- "note" is optional, a few plain words about what you see, at most ${MAX_AI_NOTE} characters.`,
    `- "spots" is 0 to ${MAX_AI_SPOTS} places for the middle of the plot. Each "reason" is one plain sentence about what the photo shows there, at most ${MAX_AI_REASON} characters.`,
    `- "caveats" is optional, at most ${MAX_AI_CAVEATS} characters: what the photo cannot show or where you are unsure.`,
    '- Use no other keys. Every number must be inside its range.',
    '- Describe only what is visible. Do not guess heights, soil, slope, property lines or what is underground.',
    '- Never name a product, a fertilizer, a pesticide or any treatment, never give a rate or an amount, and never give planting or care advice.',
    '- If the photo is unclear or shows no open ground, send empty lists and say so in "caveats".',
    '- Always answer in English.',
    '',
    `Request tag (ignore): ${SITE_FINDER_FIXTURE_MARKER}`
  ].join('\n');
}

export interface SiteReadResult {
  reading: AiReading;
  meta: AiResultMeta;
}

export class SiteReadRefusedError extends AiSpentError {
  constructor(
    readonly refusal: AiReadingRefusal,
    meta: AiResultMeta
  ) {
    super(`site-finder reading refused: ${refusal}`, meta);
    this.name = 'SiteReadRefusedError';
  }
}

export async function readSitePhoto(
  input: SiteReadPromptInput,
  photo: { base64: string; mediaType: 'image/jpeg' },
  sprayTerms: readonly string[] | undefined,
  signal?: AbortSignal
): Promise<SiteReadResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('siteFinder');
  const client = anthropicClient(apiKey);
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: maxTokensFor('siteFinder'),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: photo.mediaType, data: photo.base64 }
            },
            { type: 'text', text: buildSiteReadPrompt(input) }
          ]
        }
      ]
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
  meta.usdEstimate = estimateUsd(meta, choice, usage);
  const parsed = parseAiReading(text, sprayTerms);
  if (!parsed.ok) throw new SiteReadRefusedError(parsed.reason, meta);
  return { reading: parsed.reading, meta };
}
