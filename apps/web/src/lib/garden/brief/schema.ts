/**
 * The garden brief (Phase 37A): what a beginner wants from an herb garden,
 * saved per Owner as the `garden_brief` setting. Client-safe; the routes,
 * the page and the offline snapshot all read this one shape.
 */

import { z } from 'zod';
import { BRIEF_STORAGE_GOALS, type BriefStorageGoal } from '$lib/garden/preserving';

export const GARDEN_BRIEF_KEY = 'garden_brief';
export const GARDEN_BRIEF_UPDATED_AT_KEY = 'garden_brief_updated_at';

export const BRIEF_WHY = [
  'cooking',
  'tea',
  'pollinators-looks',
  'gifts',
  'save-money',
  'learn-with-children'
] as const;
export type BriefWhy = (typeof BRIEF_WHY)[number];

export const BRIEF_CUISINES = [
  'italian',
  'mexican',
  'thai-vietnamese',
  'french',
  'middle-eastern',
  'indian',
  'tea-drinks'
] as const;
export type BriefCuisine = (typeof BRIEF_CUISINES)[number];

export const BRIEF_TIME = ['under-1h', '1-2h', 'more'] as const;
export type BriefTime = (typeof BRIEF_TIME)[number];

export const BRIEF_SUN = ['full', 'half-day', 'shade'] as const;
export type BriefSun = (typeof BRIEF_SUN)[number];

export const BRIEF_WHERE = ['ground', 'raised', 'pots', 'windowsill'] as const;
export type BriefWhere = (typeof BRIEF_WHERE)[number];

/** The form's questions, in the order the form asks them. */
export const BRIEF_QUESTIONS = [
  'why',
  'cuisines',
  'wanted',
  'avoid',
  'time',
  'sun',
  'where',
  'storage'
] as const;
export type BriefQuestion = (typeof BRIEF_QUESTIONS)[number];

/** A conversation holds at most this many Claude turns (R-2). */
export const MAX_BRIEF_CHAT_TURNS = 8;
export const MAX_SHORTLIST = 12;
export const MAX_BECAUSE_CHARS = 240;
export const MAX_TARGET_CHARS = 120;
export const MAX_CHAT_MESSAGE_CHARS = 1000;

export const BRIEF_PROVENANCE = ['manual', 'ai', 'fallback'] as const;
export type BriefProvenance = (typeof BRIEF_PROVENANCE)[number];

const pluginId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

function answer<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      notSure: z.boolean().default(false),
      provenance: z.enum(BRIEF_PROVENANCE).default('manual')
    })
    .strict();
}

export const storageTargetSchema = z
  .object({
    goal: z.enum(BRIEF_STORAGE_GOALS),
    target: z.string().trim().max(MAX_TARGET_CHARS).optional()
  })
  .strict();

export const briefAnswersSchema = z
  .object({
    why: answer(z.array(z.enum(BRIEF_WHY)).max(BRIEF_WHY.length)).optional(),
    cuisines: answer(z.array(z.enum(BRIEF_CUISINES)).max(BRIEF_CUISINES.length)).optional(),
    wanted: answer(z.array(pluginId).max(20)).optional(),
    avoid: answer(z.array(pluginId).max(40)).optional(),
    time: answer(z.enum(BRIEF_TIME).nullable()).optional(),
    sun: answer(z.enum(BRIEF_SUN).nullable()).optional(),
    where: answer(z.array(z.enum(BRIEF_WHERE)).max(BRIEF_WHERE.length)).optional(),
    storage: answer(z.array(storageTargetSchema).max(BRIEF_STORAGE_GOALS.length)).optional()
  })
  .strict();
export type BriefAnswers = z.infer<typeof briefAnswersSchema>;

/** Why a deterministic row was picked; rendered in the viewer's language. */
export const briefReasonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cuisine'), cuisine: z.enum(BRIEF_CUISINES) }).strict(),
  z.object({ kind: z.literal('why'), why: z.enum(BRIEF_WHY) }).strict(),
  z.object({ kind: z.literal('wanted') }).strict(),
  z.object({ kind: z.literal('suggested') }).strict()
]);
export type BriefReason = z.infer<typeof briefReasonSchema>;

export const shortlistRowSchema = z
  .object({
    cropPluginId: pluginId,
    because: z.string().trim().min(1).max(MAX_BECAUSE_CHARS),
    provenance: z.enum(BRIEF_PROVENANCE),
    reasons: z.array(briefReasonSchema).max(16).optional()
  })
  .strict();
export type ShortlistRow = z.infer<typeof shortlistRowSchema>;

export const gardenBriefSchema = z
  .object({
    version: z.literal(1),
    answers: briefAnswersSchema,
    shortlist: z.array(shortlistRowSchema).max(MAX_SHORTLIST),
    chatTurns: z.number().int().min(0).max(MAX_BRIEF_CHAT_TURNS).default(0),
    updatedAt: z.number().int().nonnegative()
  })
  .strict();
export type GardenBrief = z.infer<typeof gardenBriefSchema>;

/** `PUT /api/garden/brief`. Without `shortlist` the server builds the
 *  deterministic one from the answers. */
export const gardenBriefPutSchema = z
  .object({
    answers: briefAnswersSchema,
    shortlist: z.array(shortlistRowSchema).max(MAX_SHORTLIST).optional()
  })
  .strict();
export type GardenBriefPut = z.infer<typeof gardenBriefPutSchema>;

/** `POST /api/garden/brief/chat`: one turn of the conversation. */
export const briefChatTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS)
  })
  .strict();
export type BriefChatTurn = z.infer<typeof briefChatTurnSchema>;

export const gardenBriefChatSchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
    answers: briefAnswersSchema.optional(),
    /** The conversation so far, held by the page (nothing is stored). */
    history: z
      .array(briefChatTurnSchema)
      .max(MAX_BRIEF_CHAT_TURNS * 2)
      .optional()
  })
  .strict();
export type GardenBriefChat = z.infer<typeof gardenBriefChatSchema>;

/** What Claude must answer, before the server's own checks. */
export const claudeBriefAnswerSchema = z.object({
  reply: z.string(),
  followUp: z.enum(BRIEF_QUESTIONS).nullable().optional(),
  shortlist: z.array(z.object({ cropPluginId: z.string(), because: z.string().optional() })).max(40)
});
export type ClaudeBriefAnswer = z.infer<typeof claudeBriefAnswerSchema>;

export function emptyBrief(now: number): GardenBrief {
  return { version: 1, answers: {}, shortlist: [], chatTurns: 0, updatedAt: now };
}

/** The stored setting, or null when it is missing or no longer parses. */
export function parseGardenBrief(raw: string | null | undefined): GardenBrief | null {
  if (!raw) return null;
  try {
    const parsed = gardenBriefSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The storage goals the owner picked, in canonical order. */
export function briefGoals(brief: Pick<GardenBrief, 'answers'> | null): BriefStorageGoal[] {
  const picked = new Set((brief?.answers.storage?.value ?? []).map((s) => s.goal));
  return BRIEF_STORAGE_GOALS.filter((g) => picked.has(g));
}

/** True when the brief says the herbs grow in pots or on a windowsill
 *  (37E reads it to suggest the Area's container flag). */
export function briefGrowsInPots(brief: Pick<GardenBrief, 'answers'> | null): boolean {
  const where = brief?.answers.where?.value ?? [];
  return where.includes('pots') || where.includes('windowsill');
}

/** Every plugin id the brief names: wanted, avoided and shortlisted. */
export function briefPluginIds(brief: Pick<GardenBrief, 'answers' | 'shortlist'>): string[] {
  return [
    ...new Set([
      ...(brief.answers.wanted?.value ?? []),
      ...(brief.answers.avoid?.value ?? []),
      ...brief.shortlist.map((r) => r.cropPluginId)
    ])
  ];
}

/** The questions the owner has not answered yet, "I'm not sure" counting
 *  as an answer. */
export function unansweredQuestions(answers: BriefAnswers): BriefQuestion[] {
  return BRIEF_QUESTIONS.filter((q) => {
    const a = answers[q];
    if (!a) return true;
    if (a.notSure) return false;
    const v = a.value as unknown;
    return v === null || (Array.isArray(v) && v.length === 0);
  });
}

/** The brief in the offline card snapshot (37C reads the goals and the
 *  shortlist for the Planting and Area cards). */
export interface SnapshotGardenBrief {
  goals: Array<{ goal: BriefStorageGoal; target?: string }>;
  shortlist: string[];
  updatedAt: number;
}

export function snapshotBriefOf(brief: GardenBrief): SnapshotGardenBrief {
  const targets = new Map((brief.answers.storage?.value ?? []).map((s) => [s.goal, s.target]));
  return {
    goals: briefGoals(brief).map((goal) => {
      const target = targets.get(goal);
      return target ? { goal, target } : { goal };
    }),
    shortlist: brief.shortlist.map((r) => r.cropPluginId),
    updatedAt: brief.updatedAt
  };
}

/** One line of the conversation as the page shows it. */
export interface BriefChatLine {
  role: 'user' | 'assistant';
  text: string;
  provenance?: 'ai' | 'fallback';
}
