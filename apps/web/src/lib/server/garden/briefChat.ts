/**
 * One turn of the garden brief conversation (Phase 37A, R-2, R-26). Claude
 * is asked through `tryAiWithGuard` (aiTry + aiGuard) on the `garden-brief`
 * endpoint; its answer is checked here before the owner sees it, and the
 * deterministic shortlist answers whenever Claude is off, over its limit,
 * slow, at the turn limit or returns nothing usable.
 */

import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { t, type MessageKey } from '$lib/i18n';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { asksForSprayAdvice, filterSprayAdvice, isSprayAdvice } from '$lib/journal/photoHelp';
import type { CropPlugin } from '$lib/plugins/schemas';
import {
  BRIEF_QUESTIONS,
  MAX_BECAUSE_CHARS,
  MAX_BRIEF_CHAT_TURNS,
  MAX_BRIEF_REPLY_CHARS,
  MAX_SHORTLIST,
  claudeBriefAnswerSchema,
  type BriefAnswers,
  type BriefChatTurn,
  type BriefQuestion,
  type BriefTranscriptTurn,
  type GardenBrief,
  type ShortlistRow
} from '$lib/garden/brief/schema';
import { deterministicReason, deterministicShortlist } from '$lib/garden/brief/shortlist';
import { aiLimitOf, recordFallback, tryAiWithGuard } from '../aiDegrade';
import type { FallbackReason } from '../aiTry';
import { recordCall } from '../aiGuard';
import { anthropicClient } from '../anthropicClient';
import { extractJsonObject } from '../aiJsonExtract';
import { estimateUsd, selectModel, type AiResultMeta } from '../aiPlanning';
import { getApiKey } from '../scanResult';

export const GARDEN_BRIEF_TIMEOUT_MS = 20_000;
export const GARDEN_BRIEF_MARKER = 'CROPCARD_FIXTURE:garden-brief';
const MAX_TOKENS = 1200;
const MAX_REPLY_CHARS = MAX_BRIEF_REPLY_CHARS;

export interface BriefFarmFacts {
  zone: string | null;
  frost: { lastSpring: string; firstFall: string } | null;
  areaKinds: string[];
}

export interface BriefHerbFact {
  pluginId: string;
  name: string;
  family: string;
  lifecycle: string | null;
  /** Sourced preserving methods rated good or fair (37C), when present. */
  keeps?: string[];
}

export interface BriefPromptInput {
  answers: BriefAnswers;
  farm: BriefFarmFacts;
  herbs: BriefHerbFact[];
  history: BriefChatTurn[];
  message: string;
}

const WORDS: Record<string, string> = {
  'under-1h': 'under an hour a week',
  '1-2h': 'one to two hours a week',
  more: 'more than two hours a week',
  full: 'full sun',
  'half-day': 'about half a day of sun',
  shade: 'mostly shade'
};

function listOrNotSure(
  a: { value: unknown; notSure?: boolean } | undefined,
  show: (v: string) => string = (v) => v
): string {
  if (!a) return 'not answered';
  if (a.notSure) return 'not sure';
  const v = a.value;
  if (v === null || v === undefined) return 'not answered';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'none';
    return v.map((x) => show(typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  }
  return show(String(v));
}

/** The answers in plain English for the prompt. */
export function describeAnswers(answers: BriefAnswers, nameOf: (id: string) => string): string[] {
  const storage = answers.storage?.notSure
    ? 'not sure'
    : (answers.storage?.value ?? []).length === 0
      ? answers.storage
        ? 'none'
        : 'not answered'
      : answers
          .storage!.value.map((s) => (s.target ? `${s.goal} (${s.target})` : s.goal))
          .join(', ');
  return [
    `- Why the garden: ${listOrNotSure(answers.why)}`,
    `- Cooking: ${listOrNotSure(answers.cuisines)}`,
    `- Herbs they want: ${listOrNotSure(answers.wanted, nameOf)}`,
    `- Herbs they never use (never suggest these): ${listOrNotSure(answers.avoid, nameOf)}`,
    `- Time: ${listOrNotSure(answers.time, (v) => WORDS[v] ?? v)}`,
    `- Sun: ${listOrNotSure(answers.sun, (v) => WORDS[v] ?? v)}`,
    `- Where it grows: ${listOrNotSure(answers.where)}`,
    `- What to do with the harvest: ${storage}`
  ];
}

export function buildBriefPrompt(input: BriefPromptInput): string {
  const nameOf = (id: string) => input.herbs.find((h) => h.pluginId === id)?.name ?? id;
  const frost = input.farm.frost
    ? `Average last spring frost ${input.farm.frost.lastSpring}, first fall frost ${input.farm.frost.firstFall}.`
    : 'Frost dates are not known.';
  return [
    GARDEN_BRIEF_MARKER,
    'You help someone who has never gardened plan a small herb garden for their kitchen.',
    `Farm: hardiness zone ${input.farm.zone ?? 'not known'}. ${frost} Areas: ${
      input.farm.areaKinds.length ? input.farm.areaKinds.join(', ') : 'none yet'
    }.`,
    '',
    'Their answers so far:',
    ...describeAnswers(input.answers, nameOf),
    '',
    'Herb library (suggest only these ids, exactly as written):',
    ...input.herbs.map(
      (h) =>
        `- ${h.pluginId}: ${h.name} (${h.family}, ${h.lifecycle ?? 'lifecycle not recorded'}${
          h.keeps?.length ? `, keeps by ${h.keeps.join(' or ')}` : ''
        })`
    ),
    '',
    'Conversation so far:',
    ...(input.history.length
      ? input.history.map((h) => `${h.role === 'user' ? 'Owner' : 'You'}: ${h.text}`)
      : ['- nothing yet']),
    `Owner: ${input.message}`,
    '',
    'Rules:',
    `- shortlist: at most ${MAX_SHORTLIST} herbs from the library above, never one they never use.`,
    '- because: one short, friendly sentence on why the herb fits this person.',
    '- reply: two or three plain sentences for a beginner. Ask about one thing at a time.',
    `- followUp: the next question worth asking, one of ${BRIEF_QUESTIONS.join(', ')}, or null.`,
    '- Never name or suggest a pesticide, a spray, a pest or disease product, or any brand.',
    '- Never give amounts, rates, measurements, numbers of plants or recipes.',
    '- Always answer in English.',
    '',
    'Return JSON only: { "reply": "...", "followUp": "cuisines", "shortlist": [ { "cropPluginId": "...", "because": "..." } ] }'
  ].join('\n');
}

export interface BriefAiResult {
  raw: unknown;
  meta: AiResultMeta;
}

export async function askGardenBrief(
  input: BriefPromptInput,
  signal?: AbortSignal
): Promise<BriefAiResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('gardenFill');
  const client = anthropicClient(apiKey);
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildBriefPrompt(input) }]
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
  return { raw: extractJsonObject(text), meta };
}

function clean(text: string, max: number): string {
  const trimmed = text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export interface ValidatedBriefAnswer {
  reply: string | null;
  followUp: BriefQuestion | null;
  rows: ShortlistRow[];
  /** Claude rows dropped: unknown ids, avoided herbs, repeats or past 12. */
  droppedRows: number;
  /** "because" sentences replaced by the deterministic reason. */
  replacedSentences: number;
}

/** Claude's answer after the server's checks, or null when it is not the
 *  JSON shape asked for. Herbs the owner asked for always lead, tagged
 *  `manual`; every Claude sentence passes the spray-advice guard. */
export function validateBriefAnswer(
  raw: unknown,
  ctx: {
    answers: BriefAnswers;
    known: (pluginId: string) => boolean;
    sprayTerms: readonly string[];
  }
): ValidatedBriefAnswer | null {
  const parsed = claudeBriefAnswerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const avoid = new Set(ctx.answers.avoid?.value ?? []);
  const rows: ShortlistRow[] = deterministicShortlist(
    { wanted: ctx.answers.wanted, avoid: ctx.answers.avoid },
    ctx.known
  ).rows;
  const seen = new Set(rows.map((r) => r.cropPluginId));
  let droppedRows = 0;
  let replacedSentences = 0;
  for (const item of parsed.data.shortlist) {
    const id = item.cropPluginId.trim();
    if (!ctx.known(id) || avoid.has(id) || seen.has(id) || rows.length >= MAX_SHORTLIST) {
      droppedRows++;
      continue;
    }
    seen.add(id);
    const sentence = clean(item.because ?? '', MAX_BECAUSE_CHARS);
    const filtered = sentence ? filterSprayAdvice(sentence, ctx.sprayTerms) : null;
    if (!filtered || filtered.removed || !filtered.text.trim()) {
      replacedSentences++;
      const fallback = deterministicReason(id, ctx.answers);
      rows.push({
        cropPluginId: id,
        because: fallback.because,
        provenance: 'ai',
        reasons: fallback.reasons
      });
      continue;
    }
    rows.push({ cropPluginId: id, because: filtered.text, provenance: 'ai' });
  }
  const replyText = clean(parsed.data.reply, MAX_REPLY_CHARS);
  const reply = replyText ? filterSprayAdvice(replyText, ctx.sprayTerms).text.trim() : '';
  const followUp = parsed.data.followUp ?? null;
  return {
    reply: reply && !isSprayAdvice(reply, ctx.sprayTerms) ? reply : null,
    followUp:
      followUp && (BRIEF_QUESTIONS as readonly string[]).includes(followUp) ? followUp : null,
    rows,
    droppedRows,
    replacedSentences
  };
}

export type BriefChatWhy = FallbackReason | 'invalid' | 'quota' | 'turn-limit' | 'spray';

export interface BriefChatResponse {
  reply: string;
  followUp: BriefQuestion | null;
  shortlist: ShortlistRow[];
  provenance: 'ai' | 'fallback';
  fallbackReason: BriefChatWhy | null;
  /** Shown above the result when Claude did not answer. */
  message: string | null;
  sunWarning: boolean;
  /** The owner asked for spray advice; the page shows the Spray redirect. */
  sprayRedirect: boolean;
  turnsLeft: number;
  aiLimit?: AiLimit | null;
}

function keepsOf(c: CropPlugin): string[] | undefined {
  const rows = (c as { preserving?: unknown }).preserving;
  if (!Array.isArray(rows)) return undefined;
  const methods = rows.flatMap((r) => {
    const row = r as { method?: unknown; suitability?: unknown };
    return typeof row.method === 'string' &&
      (row.suitability === 'good' || row.suitability === 'fair')
      ? [row.method]
      : [];
  });
  return methods.length ? methods : undefined;
}

export function herbFacts(crops: readonly CropPlugin[]): BriefHerbFact[] {
  const herbs = new Set(HERB_PLUGIN_IDS);
  return crops
    .filter((c) => herbs.has(c.pluginId))
    .map((c) => ({
      pluginId: c.pluginId,
      name: c.displayName,
      family: c.cropFamily,
      lifecycle: c.agronomy?.lifecycle ?? null,
      keeps: keepsOf(c)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function fallbackText(why: BriefChatWhy, limit: AiLimit | null, locale?: string | null): string {
  const lead = limit
    ? aiLimitReason(limit, locale)
    : t(locale, `herbsa.chat.why.${why}` as MessageKey, { n: MAX_BRIEF_CHAT_TURNS });
  return t(locale, 'herbsa.chat.fallbackMessage', { lead });
}

/** Runs one turn and returns what the page shows plus the brief to save. */
export async function runBriefChat(args: {
  userId: string;
  brief: GardenBrief;
  message: string;
  history: BriefChatTurn[];
  farm: BriefFarmFacts;
  herbs: BriefHerbFact[];
  known: (pluginId: string) => boolean;
  sprayTerms: readonly string[];
  now: number;
  locale?: string | null;
}): Promise<{ response: BriefChatResponse; brief: GardenBrief }> {
  const { brief, locale } = args;
  const plain = deterministicShortlist(brief.answers, args.known);
  const turnsLeft = Math.max(0, MAX_BRIEF_CHAT_TURNS - brief.chatTurns);
  const deterministic = (why: BriefChatWhy, limit: AiLimit | null = null) => {
    const kept = why === 'spray' && brief.shortlist.length > 0 ? brief.shortlist : plain.rows;
    return {
      response: {
        reply: t(locale, why === 'spray' ? 'herbsa.chat.sprayReply' : 'herbsa.chat.formReply'),
        followUp: null,
        shortlist: kept,
        provenance: 'fallback' as const,
        fallbackReason: why,
        message: why === 'spray' ? null : fallbackText(why, limit, locale),
        sunWarning: plain.sunWarning,
        sprayRedirect: why === 'spray',
        turnsLeft,
        aiLimit: limit
      },
      brief: { ...brief, shortlist: kept, updatedAt: args.now }
    };
  };

  if (asksForSprayAdvice(args.message, args.sprayTerms)) return deterministic('spray');
  if (turnsLeft <= 0) return deterministic('turn-limit');

  const tried = await tryAiWithGuard({
    endpoint: 'garden-brief',
    userId: args.userId,
    timeoutMs: GARDEN_BRIEF_TIMEOUT_MS,
    locale,
    prompt: (signal) =>
      askGardenBrief(
        {
          answers: brief.answers,
          farm: args.farm,
          herbs: args.herbs,
          history: args.history,
          message: args.message
        },
        signal
      )
  });

  if (tried.provenance === 'fallback') {
    recordFallback(args.userId, 'garden-brief', tried.fallbackReason);
    const quota = !tried.guard.ok && tried.guard.reason === 'quota-exceeded';
    return deterministic(quota ? 'quota' : tried.fallbackReason, aiLimitOf(tried.guard));
  }

  const { raw, meta } = tried.value;
  const checked = validateBriefAnswer(raw, {
    answers: brief.answers,
    known: args.known,
    sprayTerms: args.sprayTerms
  });
  const usable = !!checked && checked.rows.length > 0;
  try {
    recordCall({
      userId: args.userId,
      endpoint: 'garden-brief',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: usable,
      errorClass: usable ? undefined : checked ? 'no-valid-shortlist' : 'invalid-json',
      provenance: usable ? 'ai' : 'fallback'
    });
  } catch (err) {
    console.error('[ai] garden-brief recordCall failed', err);
  }
  const turns = brief.chatTurns + 1;
  if (!checked || !usable) {
    const out = deterministic('invalid');
    out.brief.chatTurns = turns;
    out.brief.transcript = withTurn(brief, {
      question: args.message,
      reply: null,
      provenance: 'fallback',
      at: args.now
    });
    out.response.turnsLeft = Math.max(0, MAX_BRIEF_CHAT_TURNS - turns);
    return out;
  }
  return {
    response: {
      reply: checked.reply ?? t(locale, 'herbsa.chat.formReply'),
      followUp: checked.followUp,
      shortlist: checked.rows,
      provenance: 'ai',
      fallbackReason: null,
      message: null,
      sunWarning: plain.sunWarning,
      sprayRedirect: false,
      turnsLeft: Math.max(0, MAX_BRIEF_CHAT_TURNS - turns),
      aiLimit: null
    },
    brief: {
      ...brief,
      shortlist: checked.rows,
      chatTurns: turns,
      transcript: withTurn(brief, {
        question: args.message,
        reply: checked.reply,
        provenance: 'ai',
        at: args.now
      }),
      updatedAt: args.now
    }
  };
}

/** The stored conversation with one more turn (FU870-3). Only turns that
 *  count toward the 8 are kept, so a spray question, a turn Claude never
 *  answered and the no-key path store nothing. The reply is the one the
 *  page shows: Claude's text after the spray-advice filter, or null for
 *  the form's own reply. */
function withTurn(brief: GardenBrief, turn: BriefTranscriptTurn): BriefTranscriptTurn[] {
  return [...(brief.transcript ?? []), turn].slice(-MAX_BRIEF_CHAT_TURNS);
}
