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
import { parseMarks, readMarksAnswer } from '$lib/journal/marks';
import { drawingTopic, pruneDrawingFor } from '$lib/journal/pruneDrawing';
import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { t, type MessageKey } from '$lib/i18n';
import { aiLimitOf, recordFallback, tryAiWithGuard } from './aiDegrade';
import { recordCall } from './aiGuard';
import { askPhotoHelp, type PhotoHelpPromptInput } from './aiPhotoHelp';
import type { FallbackReason } from './aiTry';
import { discardPhoto, storePhoto, type StoredPhotoRef } from './vault/photoWrite';

export const PHOTO_HELP_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export interface PhotoHelpRequest {
  question: PhotoQuestion;
  text: string;
  photo: string | null;
  /** Phase 37F: ask Claude to place marks on the photo. */
  wantMarks?: boolean;
}

export interface PhotoHelpResponse {
  provenance: 'ai' | 'fallback';
  fallbackReason: FallbackReason | null;
  message: string | null;
  answer: JournalAnswer;
  entry: JournalEntry;
  /** Set when the farm's AI allowance stopped the call, for the upgrade nudge. */
  aiLimit?: AiLimit | null;
  /** Where the marks came from when they were asked for: `ai` when they
   *  passed `parseMarks`, `fallback` when Claude's were refused or Claude
   *  was off. Null when no marks were asked for. */
  marksProvenance?: 'ai' | 'fallback' | null;
}

type Why = FallbackReason | 'quota' | 'invalid' | 'spray';

const WHY_KEY: Record<Exclude<Why, 'spray'>, MessageKey> = {
  'no-key': 'cardsui.photo.why.noKey',
  'over-cap': 'cardsui.photo.why.overCap',
  quota: 'cardsui.photo.why.quota',
  'rate-limit': 'cardsui.photo.why.rateLimit',
  offline: 'cardsui.photo.why.offline',
  timeout: 'cardsui.photo.why.timeout',
  invalid: 'cardsui.photo.why.invalid'
};

/** The banner above a Care Guide answer. The spray redirect stays English
 *  (safety wording); the rest follows the viewer's language. */
export function photoHelpMessage(
  why: Why,
  hasPhoto = true,
  limit: AiLimit | null = null,
  locale?: string | null
): string {
  const saved = t(
    locale,
    hasPhoto ? 'cardsui.photo.savedJournalPhoto' : 'cardsui.photo.savedJournal'
  );
  const lead = limit
    ? t(locale, 'cardsui.photo.why.limit', { reason: aiLimitReason(limit, locale) })
    : why === 'spray'
      ? `${SPRAY_REDIRECT} ${t(locale, 'cardsui.photo.why.spray')}`
      : t(locale, WHY_KEY[why]);
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

function careLines(plugin: SnapshotCropPlugin | null, harvest: boolean): string[] {
  return (plugin?.careTasks ?? [])
    .filter((t) => (t.crop === 'harvest') === harvest)
    .map((t) => (t.body ? `${t.title}: ${t.body}` : t.title));
}

export function promptInputFor(
  crop: Crop,
  plugin: SnapshotCropPlugin | null,
  question: string,
  now: number,
  sprayTerms?: readonly string[],
  hasPhoto = true,
  wantMarks = false
): PhotoHelpPromptInput {
  const days = crop.plantingDate !== null ? Math.floor((now - crop.plantingDate) / DAY_MS) : null;
  return {
    cropName: crop.varietyDisplayName || plugin?.displayName || 'this plant',
    family: plugin?.cropFamily ?? 'unknown family',
    plantingDate: crop.plantingDate !== null ? isoDay(crop.plantingDate) : null,
    daysSincePlanting: days !== null && days >= 0 ? days : null,
    daysToMaturity: plugin?.daysToMaturity ?? null,
    harvestIndicators: filterSprayAdviceItems(
      [...careLines(plugin, true), ...(plugin?.harvestIndicators ?? [])],
      sprayTerms
    ),
    careTasks: filterSprayAdviceItems(careLines(plugin, false), sprayTerms),
    notes: plugin?.notes ? growerFacingText(plugin.notes, sprayTerms) || null : null,
    question,
    hasPhoto,
    ...(wantMarks ? { wantMarks } : {})
  };
}

interface MarkedAnswer {
  steps: string[];
  text: string;
  removed: boolean;
  usable: boolean;
  marks: JournalAnswer['marks'];
}

/** Claude's marks answer through the spray filter and `parseMarks`. A step
 *  the filter drops shifts the numbering, so the marks go with it.
 *  `diagnosisTerms` are the library's pest and disease names (#869). */
export function markedAnswer(
  raw: string,
  sprayTerms?: readonly string[],
  diagnosisTerms?: readonly string[]
): MarkedAnswer | null {
  const read = readMarksAnswer(raw);
  if (!read) return null;
  const kept: string[] = [];
  let removed = false;
  let before = 0;
  let after = 0;
  for (const step of read.steps) {
    const plain = plainAnswer(step);
    const f = filterSprayAdvice(plain, sprayTerms);
    before += answerSentences(plain).length;
    after += answerSentences(f.text).length;
    if (f.removed) removed = true;
    if (f.text.trim()) kept.push(f.text.trim());
  }
  const usable = kept.length > 0 && !(removed && after * 2 < before);
  const parsed = removed ? null : parseMarks(read.marks, sprayTerms, diagnosisTerms);
  return {
    steps: kept,
    text: kept.join(' '),
    removed,
    usable,
    marks: parsed?.ok ? parsed.marks : undefined
  };
}

export async function answerPhotoHelp(args: {
  userId: string;
  crop: Crop;
  plugin: SnapshotCropPlugin | null;
  req: PhotoHelpRequest;
  sprayTerms?: readonly string[];
  /** Pest and disease names no mark label may hold (#869, FU869-1). */
  diagnosisTerms?: readonly string[];
  now?: number;
  /** The viewer's language for the banner message only; the saved
   *  journal entry and the prompt stay English. */
  locale?: string | null;
  /** Runs the journal insert; the route passes `writeRecord` so an offline
   *  retry with the same client record id never saves twice (R-23). */
  write?: <T>(fn: () => T) => T;
}): Promise<PhotoHelpResponse> {
  const { userId, crop, plugin, req, sprayTerms } = args;
  const now = args.now ?? Date.now();
  const asked = questionText(req.question, req.text);
  const careSections = careAnswerSections(plugin, req.question, req.text, sprayTerms);
  const wantMarks = req.wantMarks === true && !!req.photo;
  const drawing = drawingTopic(topicFor(req.question, req.text)) ? pruneDrawingFor(plugin) : null;
  const write = args.write ?? (<T>(fn: () => T) => fn());

  const stored: StoredPhotoRef | null = req.photo
    ? await storePhoto('journal-photo', req.photo, { title: 'Journal photo', uploadedBy: userId })
    : null;
  const save = (answer: JournalAnswer, provenance: 'ai' | 'fallback') =>
    write(() =>
      insertJournalEntry({
        cropId: crop.id,
        blockId: crop.blockId,
        createdBy: userId,
        kind: 'photo_help',
        text: asked,
        photoRef: stored && 'inline' in stored ? stored.inline : null,
        photoDocumentId: stored && 'documentId' in stored ? stored.documentId : null,
        answer,
        provenance
      })
    );

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
      sprayRedirect,
      ...(wantMarks ? { marksProvenance: 'fallback' as const } : {}),
      ...(drawing ? { drawing } : {})
    };
    return {
      provenance: 'fallback',
      fallbackReason: reason,
      message: photoHelpMessage(why, !!req.photo, limit, args.locale),
      answer,
      entry: save(answer, 'fallback'),
      aiLimit: limit,
      marksProvenance: wantMarks ? 'fallback' : null
    };
  };

  try {
    if (asksForSprayAdvice(asked, sprayTerms)) return fallback('spray', null);

    const tried = await tryAiWithGuard({
      endpoint: 'photo-help',
      userId,
      timeoutMs: PHOTO_HELP_TIMEOUT_MS,
      prompt: (signal) =>
        askPhotoHelp(
          promptInputFor(crop, plugin, asked, now, sprayTerms, !!req.photo, wantMarks),
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
    const marked = wantMarks
      ? markedAnswer(tried.value.text, sprayTerms, args.diagnosisTerms)
      : null;
    const text = plainAnswer(tried.value.text);
    const filtered = marked
      ? { text: marked.text, removed: marked.removed }
      : filterSprayAdvice(text, sprayTerms);
    const mostlySpray =
      filtered.removed && answerSentences(filtered.text).length * 2 < answerSentences(text).length;
    const usable = marked
      ? marked.usable
      : filtered.text.trim().length > 0 && !mostlySpray && !(wantMarks && text.includes('{'));
    const marks = marked?.marks;
    const marksRefused = wantMarks && !marks;
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
        errorClass: usable
          ? filtered.removed
            ? 'spray-advice-removed'
            : marksRefused
              ? 'marks-refused'
              : undefined
          : 'unusable',
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
      sprayRedirect: filtered.removed,
      ...(marked ? { steps: marked.steps } : {}),
      ...(marks ? { marks } : {}),
      ...(wantMarks ? { marksProvenance: marks ? ('ai' as const) : ('fallback' as const) } : {})
    };
    const notes = [
      filtered.removed ? SPRAY_REDIRECT : null,
      marksRefused ? t(args.locale, 'herbsf.marks.refused') : null
    ].filter((n): n is string => !!n);
    return {
      provenance: 'ai',
      fallbackReason: null,
      message: notes.length ? notes.join(' ') : null,
      answer,
      entry: save(answer, 'ai'),
      marksProvenance: wantMarks ? (marks ? 'ai' : 'fallback') : null
    };
  } catch (err) {
    if (stored && 'documentId' in stored) await discardPhoto(stored.documentId, userId);
    throw err;
  }
}
