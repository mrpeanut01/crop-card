/**
 * Settings → API tokens (Phase 24, UC-43).
 *
 * Owner-only surface for managing external-agent Bearer credentials.
 * Mirrors the helper-invite page shape; mint form returns plaintext via
 * the form-action's success payload so the +page.svelte can render the
 * copy-once modal.
 */

import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { issueToken, listTokensForOwner, revokeToken } from '$lib/server/apiTokens';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');
  return {
    tokens: listTokensForOwner(u.activeOwnerId)
  };
};

export const actions: Actions = {
  mint: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    if (event.locals.authVia === 'bearer') {
      return fail(403, { error: 'minting new tokens requires a cookie session' });
    }
    const fd = await event.request.formData();
    const label = String(fd.get('label') ?? '').trim();
    const isServiceAccount = fd.get('isServiceAccount') === 'on';
    if (!label || label.length > 64) {
      return fail(400, { error: 'label required (max 64 chars)' });
    }
    const issued = issueToken({
      ownerId: u.activeOwnerId,
      userId: u.id,
      label,
      isServiceAccount
    });
    // Plaintext returned ONCE via the form-action payload so the UI can
    // render a copy-once modal. The DB never sees plaintext again.
    return {
      ok: true,
      minted: {
        id: issued.id,
        token: issued.token,
        label,
        isServiceAccount
      }
    };
  },
  revoke: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    const fd = await event.request.formData();
    const tokenId = String(fd.get('tokenId') ?? '');
    if (!tokenId) return fail(400, { error: 'tokenId required' });
    const ok = revokeToken(u.activeOwnerId, tokenId);
    if (!ok) return fail(404, { error: 'token not found' });
    return { ok: true };
  }
};
