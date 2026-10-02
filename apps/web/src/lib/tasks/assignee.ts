/**
 * Phase 32F (F0-11, F0-12, F1-8). Who can be given a task, how a person is
 * named on screen and on paper, and the Mine/Everyone filter state.
 */

import { t } from '$lib/i18n';

export const ASSIGNABLE_ROLES = ['owner', 'helper', 'custom-operator'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ASSIGNEE_WHO = ['mine', 'all'] as const;
export type AssigneeWho = (typeof ASSIGNEE_WHO)[number];

export interface MemberLike {
  email: string | null;
  phone: string | null;
  displayName?: string | null;
}

/** The name a card, a print or a digest shows: the chosen name, else the
 *  email local-part, else the last four digits of the phone. Never a full
 *  email address or phone number (F0-12). */
export function memberName(u: MemberLike, locale?: string | null): string {
  const chosen = u.displayName?.trim();
  if (chosen) return chosen;
  const local = u.email?.split('@')[0]?.trim();
  if (local) return local;
  const digits = (u.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 4)
    return t(locale, 'tasks.member.phoneEnding', { digits: digits.slice(-4) });
  return t(locale, 'tasks.member.fallback');
}

const PHONE_ENDING = /^phone ending (\d{4})$/;

/** A name `memberName` already built in English, in the viewer's
 *  language: only its two fallbacks change, a chosen name never does. */
export function memberNameIn(name: string, locale?: string | null): string {
  if (!locale) return name;
  if (name === 'Farm member') return t(locale, 'tasks.member.fallback');
  const phone = PHONE_ENDING.exec(name);
  return phone ? t(locale, 'tasks.member.phoneEnding', { digits: phone[1] }) : name;
}

export function isAssigneeWho(v: unknown): v is AssigneeWho {
  return typeof v === 'string' && (ASSIGNEE_WHO as readonly string[]).includes(v);
}

/** F1-8: helpers and custom operators start on Mine when something in view
 *  is theirs; owners, inspectors and anyone with nothing assigned start on
 *  Everyone. */
export function defaultAssigneeWho(
  role: string | null | undefined,
  userId: string | null | undefined,
  openTasks: readonly { assigneeUserId?: string | null }[]
): AssigneeWho {
  if (!userId || (role !== 'helper' && role !== 'custom-operator')) return 'all';
  return openTasks.some((t) => t.assigneeUserId === userId) ? 'mine' : 'all';
}

export function resolveAssigneeWho(
  raw: string | null | undefined,
  fallback: AssigneeWho
): AssigneeWho {
  return isAssigneeWho(raw) ? raw : fallback;
}

export const ASK_THE_OWNER = 'Ask the owner.';
