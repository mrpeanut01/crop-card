import { fail, type Actions } from '@sveltejs/kit';
import { requireSuperadmin } from '$lib/server/auth';
import { feedbackPeople, feedbackStatusCounts, listFeedback } from '$lib/db/feedback';
import { identityLabel } from '$lib/identity';
import { sendFeedbackToGithub, triageFeedback } from '$lib/server/feedback';
import { githubFeedbackConfig } from '$lib/server/githubFeedback';
import {
  feedbackTriageSchema,
  githubIssueDraft,
  githubSendSchema,
  isFeedbackStatus
} from '$lib/feedback/model';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireSuperadmin(event);
  const raw = event.url.searchParams.get('status');
  const status = isFeedbackStatus(raw) ? raw : null;
  const config = githubFeedbackConfig();
  const rows = listFeedback({ status, limit: 200 });
  const { farms, people } = feedbackPeople(rows);
  return {
    status,
    counts: feedbackStatusCounts(),
    github: config ? { repo: config.repo } : null,
    items: rows.map((f) => {
      const farm = f.ownerId ? farms[f.ownerId] : undefined;
      const person = f.userId ? people[f.userId] : undefined;
      return {
        ...f,
        farmName: farm?.name ?? null,
        farmSlug: farm?.slug ?? null,
        who: person ? identityLabel(person) : null,
        draft: githubIssueDraft(f)
      };
    })
  };
};

export const actions: Actions = {
  triage: async (event) => {
    const u = requireSuperadmin(event);
    const fd = await event.request.formData();
    const id = String(fd.get('id') ?? '');
    const parsed = feedbackTriageSchema.safeParse({
      status: fd.get('status'),
      adminNotes: String(fd.get('adminNotes') ?? '')
    });
    if (!id || !parsed.success) return fail(400, { id, error: 'Pick a status and try again.' });
    const row = triageFeedback(id, parsed.data, u.id);
    if (!row) return fail(404, { id, error: 'That feedback no longer exists.' });
    return { id, saved: true };
  },
  github: async (event) => {
    const u = requireSuperadmin(event);
    const fd = await event.request.formData();
    const id = String(fd.get('id') ?? '');
    const parsed = githubSendSchema.safeParse({ title: fd.get('title'), body: fd.get('body') });
    if (!id || !parsed.success) {
      return fail(400, { id, error: 'The issue needs a title and some text.' });
    }
    const result = await sendFeedbackToGithub(id, parsed.data, u.id);
    if (result.ok) return { id, githubUrl: result.url };
    switch (result.reason) {
      case 'not-configured':
        return fail(409, { id, error: 'GitHub is not set up on this server.' });
      case 'not-found':
        return fail(404, { id, error: 'That feedback no longer exists.' });
      case 'already-sent':
        return fail(409, { id, error: 'This one is already on GitHub.' });
      case 'in-flight':
        return fail(409, { id, error: 'This one is being sent right now. Refresh in a moment.' });
      case 'request-failed':
        return fail(504, {
          id,
          error: 'GitHub did not answer in time. Check the repo for the issue before trying again.'
        });
      default:
        return fail(502, {
          id,
          error: `GitHub did not accept the issue${'status' in result && result.status ? ` (HTTP ${result.status})` : ''}. Nothing was sent.`
        });
    }
  }
};
