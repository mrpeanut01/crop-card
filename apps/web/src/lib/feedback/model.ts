import { z } from 'zod';

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Something is broken',
  idea: 'Idea or request',
  other: 'Something else'
};

export const FEEDBACK_STATUSES = ['new', 'triaged', 'in-progress', 'done', 'wont-fix'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  'in-progress': 'In progress',
  done: 'Done',
  'wont-fix': "Won't fix"
};

export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_NOTES_MAX = 4000;
export const FEEDBACK_PATH_MAX = 300;
export const FEEDBACK_USER_AGENT_MAX = 400;

/** Submissions a single user may send per rolling hour. */
export const FEEDBACK_HOURLY_LIMIT = 10;

/** Paths whose next segment is a bearer secret (invite and unsubscribe
 *  tokens). The segment is replaced so it never reaches triage or GitHub. */
const SECRET_SEGMENT = /^(\/(?:invite|unsubscribe)\/)[^/]+/;

/**
 * Keeps only the pathname of a page URL: no query string, no fragment, no
 * origin. Ids and tokens in `?...` must never reach the triage queue (and
 * from there a public GitHub issue).
 */
export function sanitizeFeedbackPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let path = trimmed;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) path = new URL(trimmed).pathname;
  } catch {
    return null;
  }
  path = path.split(/[?#]/, 1)[0];
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  path = path.replace(/[^\x21-\x7e]/g, '');
  path = path.replace(SECRET_SEGMENT, (_m, prefix: string) => `${prefix}redacted`);
  return path.slice(0, FEEDBACK_PATH_MAX) || null;
}

export const feedbackSubmitSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z
    .string()
    .trim()
    .min(3, 'Please write a few words.')
    .max(FEEDBACK_MESSAGE_MAX, `Please keep it under ${FEEDBACK_MESSAGE_MAX} characters.`),
  pagePath: z.string().max(2000).optional().nullable()
});
export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>;

export const feedbackTriageSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  adminNotes: z.string().max(FEEDBACK_NOTES_MAX).optional().default('')
});

export function isFeedbackStatus(s: unknown): s is FeedbackStatus {
  return typeof s === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(s);
}

export interface GithubIssueDraftInput {
  kind: FeedbackKind;
  message: string;
  pagePath: string | null;
  appVersion: string | null;
  role: string | null;
  createdAt: number;
}

/** Default issue text the superadmin reviews before sending. Carries no
 *  email, phone, farm name or ids: only what makes the report actionable. */
export function githubIssueDraft(input: GithubIssueDraftInput): { title: string; body: string } {
  const prefix = input.kind === 'bug' ? 'Bug' : input.kind === 'idea' ? 'Idea' : 'Feedback';
  const firstLine = input.message.split(/\r?\n/, 1)[0].trim();
  const short = firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}...` : firstLine;
  const title = `${prefix}: ${short || 'In-app feedback'}`;
  const context = [
    input.pagePath ? `- Page: \`${input.pagePath}\`` : null,
    input.role ? `- Role: ${input.role}` : null,
    input.appVersion ? `- App version: \`${input.appVersion}\`` : null,
    `- Sent: ${new Date(input.createdAt).toISOString().slice(0, 10)}`
  ].filter(Boolean);
  const body = [input.message.trim(), '', '---', 'From the in-app feedback form.', ...context].join(
    '\n'
  );
  return { title, body };
}

export const githubSendSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20000)
});
