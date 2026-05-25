/**
 * POST /api/wizard/chat — append a wizard chat message.
 * GET  /api/wizard/chat?planId=... — read the active session's history.
 *
 * Phase 25d (#89). Backs the AllocationWizard's chat panels with server
 * persistence so reload doesn't lose the conversation.
 *
 * Both verbs require an authenticated owner-context user (canMutate for
 * POST; canRead inferred from session presence for GET). Helper roles
 * may append messages on the active session — chat is collaborative,
 * not edit-locked.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import {
  appendMessage,
  getActiveSession,
  getOrCreateActiveSession,
  listMessages,
  markSessionCompleted,
  type WizardStep
} from '$lib/db/wizardChat';

const postSchema = z.object({
  planId: z.string().min(1).max(64),
  step: z.enum(['allocation', 'schedule', 'inputs']),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(20_000),
  /** Optional — closes the session after appending this message. The
   *  wizard sets this when the operator commits, so resuming after
   *  commit spawns a fresh session instead of continuing the prior
   *  chat. */
  completeSession: z.boolean().optional()
});

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const session = getOrCreateActiveSession(parsed.data.planId, auth.id);
  const message = appendMessage({
    sessionId: session.id,
    step: parsed.data.step,
    role: parsed.data.role,
    content: parsed.data.content
  });

  if (parsed.data.completeSession) {
    markSessionCompleted(session.id);
  }

  return json({ message, sessionId: session.id }, { status: 201 });
};

export const GET: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });

  const planId = event.url.searchParams.get('planId');
  if (!planId) return json({ error: 'planId required' }, { status: 400 });

  const stepParam = event.url.searchParams.get('step');
  const step: WizardStep | undefined =
    stepParam === 'allocation' || stepParam === 'schedule' || stepParam === 'inputs'
      ? stepParam
      : undefined;

  const session = getActiveSession(planId);
  if (!session) {
    return json({ session: null, messages: [] });
  }
  const messages = listMessages(session.id, step);
  return json({ session, messages });
};
