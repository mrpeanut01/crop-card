/**
 * #475: Claude's bed layout for the seed being planted. The endpoint runs
 * this through `tryAiWithGuard` (aiTry + aiGuard) on the Fill this bed
 * allowance, and `checkBedProposal` checks every bed before the owner sees
 * it. Anything that does not fit answers with the plain plan instead.
 */

import { anthropicClient } from './anthropicClient';
import { z } from 'zod';
import { MAX_SUGGESTED_BEDS, type BedLayoutCrop, type BedLayoutOptions } from '$lib/plan/bedLayout';
import { extractJsonObject } from './aiJsonExtract';
import { estimateUsd, selectModel, type AiResultMeta } from './aiPlanning';
import { getApiKey } from './scanResult';

const MAX_NOTE_CHARS = 160;

export interface BedLayoutAiResult {
  beds: Array<{
    widthFt: number;
    lengthFt: number;
    crops: Array<{ key: string; plants: number }>;
  }> | null;
  note: string | null;
  meta: AiResultMeta;
}

export function buildBedLayoutPrompt(
  crops: readonly BedLayoutCrop[],
  opts: BedLayoutOptions
): string {
  return [
    'Group this seed into garden beds for one season.',
    `The owner's usual bed is ${opts.bedWidthFt} ft wide and at most ${opts.maxBedLengthFt} ft long.`,
    '',
    'Seed to place (key: name, family, plants, in-row spacing, spacing between rows):',
    ...crops.map(
      (c) =>
        `- ${c.key}: ${c.name}, ${c.family ?? 'unknown family'}, ${c.plants} plants, ${c.inRowIn} in in-row, ${c.rowIn} in between rows`
    ),
    '',
    'Rules:',
    '- Place every plant of every seed exactly once. A seed may be split across beds.',
    `- Each bed is at most ${opts.bedWidthFt} ft wide and at most ${opts.maxBedLengthFt} ft long. A bed may be wider only when one row of a crop in it needs more width, and longer only when one plant needs more length. At most ${MAX_SUGGESTED_BEDS} beds.`,
    "- Crops run in rows across the bed's width, one after another along its length, at the spacing given. Make each bed long enough for them.",
    '- Keep a crop family together where you can, and put tall crops in their own beds so they do not shade short ones.',
    `- note: one plain sentence under ${MAX_NOTE_CHARS} characters about the grouping, or omit it. No spray advice.`,
    '',
    'Return JSON only: { "beds": [ { "widthFt": 4, "lengthFt": 12, "crops": [ { "key": "...", "plants": 24 } ] } ], "note": "..." }'
  ].join('\n');
}

const replySchema = z.object({
  beds: z
    .array(
      z.object({
        widthFt: z.number().finite(),
        lengthFt: z.number().finite(),
        crops: z
          .array(z.object({ key: z.string().min(1).max(128), plants: z.number().finite() }))
          .max(40)
      })
    )
    .max(MAX_SUGGESTED_BEDS * 2),
  note: z.string().optional()
});

export function parseBedLayoutResponse(text: string): Pick<BedLayoutAiResult, 'beds' | 'note'> {
  const parsed = replySchema.safeParse(extractJsonObject(text));
  if (!parsed.success) return { beds: null, note: null };
  const note = parsed.data.note?.replace(/\p{Cc}/gu, ' ').trim() ?? '';
  return {
    beds: parsed.data.beds,
    note: note ? note.slice(0, MAX_NOTE_CHARS) : null
  };
}

export async function suggestBedLayout(
  crops: readonly BedLayoutCrop[],
  opts: BedLayoutOptions,
  signal?: AbortSignal
): Promise<BedLayoutAiResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('gardenFill');
  const client = anthropicClient(apiKey);
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: 1500,
      messages: [{ role: 'user', content: buildBedLayoutPrompt(crops, opts) }]
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
  return { ...parseBedLayoutResponse(text), meta };
}
