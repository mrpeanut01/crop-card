import { json, type RequestEvent } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import type { AddRefusal } from './passkeys';

/** adapter-node resolves this from ADDRESS_HEADER / XFF_DEPTH when set. */
export function clientAddressOf(event: RequestEvent): string | null {
  try {
    return event.getClientAddress();
  } catch {
    return null;
  }
}

/** P38-5 / P38-8 refusals: 403 with a code the browser maps to its prompt. */
export function refusalResponse(refusal: AddRefusal, locale: string | null | undefined) {
  return json(
    {
      error: t(locale, refusal === 'demo' ? 'passkey.err.demo' : 'passkey.err.reauth'),
      code: refusal === 'demo' ? 'DEMO_DISABLED' : 'REAUTH_REQUIRED'
    },
    { status: 403 }
  );
}
