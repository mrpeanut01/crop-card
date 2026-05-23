import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { issueCredential, listCredentials, revokeCredential } from '$lib/server/appCreds';
import { setCredentialTrust } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event);
  return {
    credentials: listCredentials()
  };
};

export const actions: Actions = {
  mint: async (event) => {
    const admin = requireAdmin(event);
    const data = await event.request.formData();
    const label = String(data.get('label') ?? '').trim();
    const trustLevel = String(data.get('trustLevel') ?? 'community');
    if (!label) return fail(400, { error: 'label required' });
    if (trustLevel !== 'trusted' && trustLevel !== 'community') {
      return fail(400, { error: 'trustLevel must be trusted | community' });
    }
    const issued = issueCredential({ label, trustLevel });
    // Plaintext shown ONCE in the action result; refresh discards it.
    return {
      minted: {
        token: issued.token,
        label: issued.record.label,
        trustLevel: issued.record.trustLevel,
        id: issued.record.id
      },
      mintedByAdmin: admin.email
    };
  },
  revoke: async (event) => {
    requireAdmin(event);
    const data = await event.request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'id required' });
    revokeCredential(id);
    return { revoked: id };
  },
  setTrust: async (event) => {
    const admin = requireAdmin(event);
    const data = await event.request.formData();
    const id = String(data.get('id') ?? '');
    const trustLevel = String(data.get('trustLevel') ?? '');
    if (!id || (trustLevel !== 'trusted' && trustLevel !== 'community')) {
      return fail(400, { error: 'id + trustLevel required' });
    }
    const result = setCredentialTrust({
      credentialId: id,
      trustLevel,
      adminUserId: admin.adminUserId
    });
    if (!result.ok) return fail(400, { error: result.reason ?? 'failed' });
    return { trustChanged: id };
  }
};
