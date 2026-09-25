/**
 * NFR-06 — deliver a notification to stored subscriptions and keep the
 * subscription table healthy: 404/410 from the push service deletes the row,
 * any other failure bumps `failure_count`, a success resets it.
 *
 * Must run inside a tenant context (request or `runWithTenant`); every repo
 * call below is owner-scoped.
 */

import {
  deleteSubscriptionById,
  markSubscriptionFailure,
  markSubscriptionSuccess,
  type PushSubscriptionRecord
} from '$lib/db/pushSubscriptions';
import type { PushAlert } from './triggers';
import { sendWebPush, type SendOptions, type VapidConfig } from './webPush';

export interface NotificationMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
  kind?: string;
}

export interface DispatchSummary {
  sent: number;
  removed: number;
  failed: number;
}

export async function sendToSubscriptions(
  subs: PushSubscriptionRecord[],
  message: NotificationMessage,
  config: VapidConfig,
  opts: SendOptions = {}
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, removed: 0, failed: 0 };
  const payload = JSON.stringify(message);
  for (const sub of subs) {
    const outcome = await sendWebPush(sub, payload, config, opts);
    if (outcome.kind === 'sent') {
      markSubscriptionSuccess(sub.id, opts.nowMs);
      summary.sent++;
    } else if (outcome.kind === 'gone') {
      deleteSubscriptionById(sub.id);
      summary.removed++;
    } else {
      markSubscriptionFailure(sub.id);
      summary.failed++;
      console.warn(
        `[push] delivery failed sub=${sub.id} status=${outcome.status ?? 'n/a'}: ${outcome.message}`
      );
    }
  }
  return summary;
}

export interface MemberRole {
  userId: string;
  roleWithinOwner: string;
  status: string;
}

/**
 * Which of the Owner's subscriptions should receive `alert`: the user must
 * still hold an active, non-inspector assignment on this Owner, must have
 * the alert kind enabled, and must fall inside the alert's audience.
 */
export function selectRecipients(
  subs: PushSubscriptionRecord[],
  members: MemberRole[],
  alert: Pick<PushAlert, 'kind' | 'audience'>
): PushSubscriptionRecord[] {
  const roleByUser = new Map<string, string>();
  for (const m of members) {
    if (m.status === 'active' && m.roleWithinOwner !== 'inspector') {
      roleByUser.set(m.userId, m.roleWithinOwner);
    }
  }
  return subs.filter((s) => {
    const role = roleByUser.get(s.userId);
    if (!role) return false;
    if (!s.prefs[alert.kind]) return false;
    if (alert.audience.kind === 'all') return true;
    return role === 'owner' || alert.audience.userIds.includes(s.userId);
  });
}
