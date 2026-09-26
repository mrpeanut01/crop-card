/** Shared by the server fence (`lib/server/ops/fenceResponse.ts`) and the
 *  pages that queue records, so both sides agree on how a deploy handoff
 *  looks on the wire. */
export const UPDATING_CODE = 'SERVER_UPDATING';
export const UPDATING_MESSAGE = 'CropCard is updating. Nothing was saved. Try again in a moment.';
export const UPDATING_QUEUED_NOTICE =
  'CropCard is updating, so this was saved on this device. It will send in a moment.';

/** True when a response is the deploy fence's 503: nothing was written and
 *  the same request can be sent again. */
export function isUpdatingResponse(res: Pick<Response, 'status' | 'headers'>): boolean {
  return res.status === 503 && res.headers.get('x-cropcard-updating') === '1';
}

/** Seconds to wait before retrying, from Retry-After (default 10). */
export function retryAfterSeconds(res: Pick<Response, 'headers'>): number {
  const n = Number(res.headers.get('retry-after'));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 120) : 10;
}
