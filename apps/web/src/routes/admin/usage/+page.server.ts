import { fail, type Actions } from '@sveltejs/kit';
import { requireSuperadmin } from '$lib/server/auth';
import {
  buildUsageReport,
  readReportRecipients,
  sendUsageReport,
  usageReportSubject,
  usageReportText
} from '$lib/server/ops/usageReport';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireSuperadmin(event);
  const report = buildUsageReport();
  return {
    subject: usageReportSubject(report),
    text: usageReportText(report),
    recipientCount: readReportRecipients().length
  };
};

export const actions: Actions = {
  send: async (event) => {
    const u = requireSuperadmin(event);
    const recipients = readReportRecipients();
    if (recipients.length === 0) return fail(400, { error: 'OPS_REPORT_TO is not set.' });
    try {
      const sent = await sendUsageReport(recipients);
      console.log('[ops-report] sent on demand', JSON.stringify({ by: u.id, sent }));
      return { sent };
    } catch (err) {
      console.error('[ops-report] on-demand send failed', err);
      return fail(502, { error: 'The email could not be sent. Check the email transport.' });
    }
  }
};
