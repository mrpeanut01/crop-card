/** "Ask about a photo" with Claude (Phase 30G). The endpoint runs this through
 *  `tryAiWithGuard` (aiTry + aiGuard). Claude sees the photo and the crop
 *  plugin's own guide; its reply is filtered for spray advice before anyone
 *  reads it. */

import Anthropic from '@anthropic-ai/sdk';
import { JPEG_DATA_URL_PREFIX } from '$lib/journal/photo';
import { estimateUsd, selectModel, type AiResultMeta } from './aiPlanning';
import { getApiKey } from './scanResult';

export const MAX_ANSWER_CHARS = 700;

export interface PhotoHelpPromptInput {
  cropName: string;
  family: string;
  plantingDate: string | null;
  daysSincePlanting: number | null;
  daysToMaturity: { min: number; max: number } | null;
  harvestIndicators: string[];
  careTasks: string[];
  notes: string | null;
  question: string;
}

export interface PhotoHelpAiResult {
  text: string;
  meta: AiResultMeta;
}

export function buildPhotoHelpPrompt(input: PhotoHelpPromptInput): string {
  const lines = [
    `A home gardener or small farmer is asking about the plant in this photo: ${input.cropName} (${input.family}).`,
    input.plantingDate
      ? `Planted ${input.plantingDate}${input.daysSincePlanting !== null ? `, ${input.daysSincePlanting} days ago` : ''}.`
      : 'Planting date unknown.',
    input.daysToMaturity
      ? `Usually ready ${input.daysToMaturity.min}-${input.daysToMaturity.max} days after planting.`
      : '',
    input.harvestIndicators.length
      ? `Ready-to-pick signs from the seed company: ${input.harvestIndicators.join('; ')}.`
      : '',
    input.careTasks.length ? `Pruning steps for this crop: ${input.careTasks.join('; ')}.` : '',
    input.notes ? `Variety notes: ${input.notes}` : '',
    '',
    `Their question: ${input.question}`,
    '',
    'Rules:',
    '- Answer in plain, warm words in 2 to 4 short sentences, under 80 words.',
    '- Say what you can see in the photo. If the photo is unclear, say so and say what photo would help.',
    '- Stick to cultural care: picking, pruning, watering, feeding, removing affected leaves, spacing, mulch, hand-picking pests.',
    '- Never name a pesticide, fungicide, herbicide or other product, never give a rate or mix amount, and never say when to spray. If a spray might be needed, say only: check the Spray flow and the product label.',
    '- No lists, no headings, no dashes between clauses.'
  ];
  return lines.filter(Boolean).join('\n');
}

export function base64OfDataUrl(dataUrl: string): string {
  return dataUrl.startsWith(JPEG_DATA_URL_PREFIX)
    ? dataUrl.slice(JPEG_DATA_URL_PREFIX.length)
    : dataUrl;
}

export async function askPhotoHelp(
  input: PhotoHelpPromptInput,
  photoDataUrl: string | null,
  signal?: AbortSignal
): Promise<PhotoHelpAiResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('photoHelp');
  const client = new Anthropic({ apiKey });
  const prompt = buildPhotoHelpPrompt(input);
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: photoDataUrl
            ? [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64OfDataUrl(photoDataUrl)
                  }
                },
                { type: 'text', text: prompt }
              ]
            : prompt
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
  return { text: text.trim().slice(0, MAX_ANSWER_CHARS), meta };
}
