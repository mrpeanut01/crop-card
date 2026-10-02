import { t } from '$lib/i18n';

/** Plain-English text for a refused amendments request: the server's
 *  `message`, else the first field issue, else a generic line. */
export async function responseMessage(res: Response, locale?: string | null): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
    issues?: Array<{ message?: string }>;
  } | null;
  if (body?.message) return body.message;
  if (body?.issues?.[0]?.message) return body.issues[0].message;
  if (res.status === 403) return t(locale, 'amend.err.ownerOnly');
  return t(locale, 'amend.err.http', { status: res.status });
}

export const OFFLINE_TEXT = "We couldn't reach CropCard. Check your signal and try again.";

export function offlineText(locale?: string | null): string {
  return t(locale, 'amend.err.offline');
}
