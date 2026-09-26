/** Photo help (Phase 30G): Claude answers through `tryAiWithGuard` with the
 *  crop plugin as grounding, and the Care Guide answers whenever Claude is
 *  off, over a limit, slow, or strays into spray advice. Every ask is saved
 *  to the planting journal. */

import type { Crop } from '$lib/db/crops';
import { insertJournalEntry } from '$lib/db/plantingJournal';
import { careGuideSections } from '$lib/cards/build/careGuide';
import type { SnapshotCropPlugin } from '$lib/cards/snapshot';
import {
  questionText,
  type JournalAnswer,
  type JournalAnswerSection,
  type JournalEntry,
  type PhotoQuestion
} from '$lib/journal/model';
import {
  SPRAY_REDIRECT,
  asksForSprayAdvice,
  careSectionsFor,
  filterSprayAdvice,
  filterSprayAdviceItems,
  answerSentences,
  growerFacingText,
  topicFor
} from '$lib/journal/photoHelp';
import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { aiLimitOf, recordFallback, tryAiWithGuard } from './aiDegrade';
import { recordCall } from './aiGuard';
import { askPhotoHelp, type PhotoHelpPromptInput } from './aiPhotoHelp';
import type { FallbackReason } from './aiTry';

export const PHOTO_HELP_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export interface PhotoHelpRequest {
  question: PhotoQuestion;
  text: string;
  photo: string | null;
}

export interface PhotoHelpResponse {
  provenance: 'ai' | 'fallback';
  fallbackReason: FallbackReason | null;
  message: string | null;
  answer: JournalAnswer;
  entry: JournalEntry;
  /** Set when the farm's AI allowance stopped the call, for the upgrade nudge. */
  aiLimit?: AiLimit | null;
}

type Why = FallbackReason | 'quota' | 'invalid' | 'spray';

const WHY_MESSAGE: Record<Why, string> = {
  'no-key': 'Claude is off, so here is what the Care Guide says.',
  'over-cap': "This month's AI help for your farm is used up, so here is what the Care Guide says.",
  quota: "Today's AI help for photos is used up, so here is what the Care Guide says.",
  'rate-limit': "Claude isn't answering right now, so here is what the Care Guide says.",
  offline: "Claude can't be reached right now, so here is what the Care Guide says.",
  timeout: 'Claude took too long, so here is what the Care Guide says.',
  invalid: "Claude's answer could not be used, so here is what the Care Guide says.",
  spray: `${SPRAY_REDIRECT} Here is what the Care Guide says.`
};

export function photoHelpMessage(why: Why, hasPhoto = true, limit: AiLimit | null = null): string {
  const saved = hasPhoto
    ? 'Your photo and question are saved in the journal.'
    : 'Your question is saved in the journal.';
  const lead = limit
    ? `${aiLimitReason(limit)}, so here is what the Care Guide says.`
    : WHY_MESSAGE[why];
  return `${lead} ${saved}`;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Claude's answer as plain sentences: no markdown headings, bullets or
 *  emphasis, which the grower would otherwise see as stray symbols. */
export function plainAnswer(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function careAnswerSections(
  plugin: SnapshotCropPlugin | null,
  question: PhotoQuestion,
  text: string,
  sprayTerms?: readonly string[]
): JournalAnswerSection[] {
  const sections = plugin
    ? careGuideSections(plugin, sprayTerms).sections.map((s) => ({
        title: s.title,
        items: filterSprayAdviceItems(s.items, sprayTerms),
        provenance: s.provenance === 'plugin' ? ('plugin' as const) : ('fallback' as const)
      }))
    : [];
  return careSectionsFor(sections, topicFor(question, text));
}

export function promptInputFor(
  crop: Crop,
  plugin: SnapshotCropPlugin | null,
  question: string,
  now: number,
  sprayTerms?: readonly string[],
  hasPhoto = true
): PhotoHelpPromptInput {
  const days = crop.plantingDate !== null ? Math.floor((now - crop.plantingDate) / DAY_MS) : null;
  return {
    cropName: crop.varietyDisplayName || plugin?.displayName || 'this plant',
    family: plugin?.cropFamily ?? 'unknown family',
    plantingDate: crop.plantingDate !== null ? isoDay(crop.plantingDate) : null,
    daysSincePlanting: days !== null && days >= 0 ? days : null,
    daysToMaturity: plugin?.daysToMaturity ?? null,
    harvestIndicators: filterSprayAdviceItems(plugin?.harvestIndicators ?? [], sprayTerms),
    careTasks: filterSprayAdviceItems(
      (plugin?.careTasks ?? []).map((t) => (t.body ? `${t.title}: ${t.body}` : t.title)),
      sprayTerms
    ),
    notes: plugin?.notes ? growerFacingText(plugin.notes, sprayTerms) || null : null,
    question,
    hasPhoto
  };
}

export async function answerPhotoHelp(args: {
  userId: string;
  crop: Crop;
  plugin: SnapshotCropPlugin | null;
  req: PhotoHelpRequest;
  sprayTerms?: readonly string[];
  now?: number;
}): Promise<PhotoHelpResponse> {
  const { userId, crop, plugin, req, sprayTerms } = args;
  const now = args.now ?? Date.now();
  const asked = questionText(req.question, req.text);
  const careSections = careAnswerSections(plugin, req.question, req.text, sprayTerms);

  const save = (answer: JournalAnswer, provenance: 'ai' | 'fallback') =>
    insertJournalEntry({
      cropId: crop.id,
      blockId: crop.blockId,
      createdBy: userId,
      kind: 'photo_help',
      text: asked,
      photoRef: req.photo,
      answer,
      provenance
    });

  const fallback = (
    why: Why,
    reason: FallbackReason | null,
    sprayRedirect = why === 'spray',
    limit: AiLimit | null = null
  ): PhotoHelpResponse => {
    const answer: JournalAnswer = {
      question: req.question,
      text: '',
      source: 'fallback',
      sections: careSections,
      sprayRedirect
    };
    return {
      provenance: 'fallback',
      fallbackReason: reason,
      message: photoHelpMessage(why, !!req.photo, limit),
      answer,
      entry: save(answer, 'fallback'),
      aiLimit: limit
    };
  };

  if (asksForSprayAdvice(asked, sprayTerms)) return fallback('spray', null);

  const tried = await tryAiWithGuard({
    endpoint: 'photo-help',
    userId,
    timeoutMs: PHOTO_HELP_TIMEOUT_MS,
    prompt: (signal) =>
      askPhotoHelp(
        promptInputFor(crop, plugin, asked, now, sprayTerms, !!req.photo),
        req.photo,
        signal
      )
  });

  if (tried.provenance === 'fallback') {
    recordFallback(userId, 'photo-help', tried.fallbackReason);
    const why: Why =
      !tried.guard.ok && tried.guard.reason === 'quota-exceeded' ? 'quota' : tried.fallbackReason;
    return fallback(why, tried.fallbackReason, false, aiLimitOf(tried.guard));
  }

  const { meta } = tried.value;
  const text = plainAnswer(tried.value.text);
  const filtered = filterSprayAdvice(text, sprayTerms);
  const mostlySpray =
    filtered.removed && answerSentences(filtered.text).length * 2 < answerSentences(text).length;
  const usable = filtered.text.trim().length > 0 && !mostlySpray;
  try {
    recordCall({
      userId,
      endpoint: 'photo-help',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: usable,
      errorClass: usable ? (filtered.removed ? 'spray-advice-removed' : undefined) : 'unusable',
      provenance: usable ? 'ai' : 'fallback'
    });
  } catch (err) {
    console.error('[ai] photo-help recordCall failed', err);
  }
  if (!usable) return fallback('invalid', null, filtered.removed);

  const answer: JournalAnswer = {
    question: req.question,
    text: filtered.text,
    source: 'ai',
    sections: [],
    sprayRedirect: filtered.removed
  };
  return {
    provenance: 'ai',
    fallbackReason: null,
    message: filtered.removed ? SPRAY_REDIRECT : null,
    answer,
    entry: save(answer, 'ai')
  };
}
