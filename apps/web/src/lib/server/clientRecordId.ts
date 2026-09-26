import { json, type RequestHandler } from '@sveltejs/kit';
import {
  claimClientRecord,
  completeClientRecord,
  releaseClientRecord
} from '$lib/db/clientRecords';
import { currentOwnerId } from '$lib/db/tenant';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

/** Makes a record endpoint safe to replay from the offline queue. A request
 *  carrying a client record id that was already saved gets a success answer
 *  and writes nothing; a request without one runs unchanged.
 *
 *  The fencing token protects the receipt row, not the record itself. A
 *  handler that runs past `STALE_CLAIM_MS` can lose its claim to a retry
 *  that then saves the record too, so the record is saved twice. Handlers
 *  are async and SQLite transactions here are synchronous, so the write and
 *  the completion can't share one; the lost claim is logged instead. */
export function withClientRecordId(handler: RequestHandler): RequestHandler {
  return async (event) => {
    const raw = event.request.headers.get(CLIENT_RECORD_HEADER);
    const key = raw && ID_PATTERN.test(raw) ? raw : null;
    if (!key || !currentOwnerId()) return handler(event);
    const claim = claimClientRecord(key, event.url.pathname);
    if (claim.status === 'done') return json({ ok: true, duplicate: true }, { status: 200 });
    if (claim.status === 'pending') {
      return json(
        { error: 'This record is already being saved. It will retry shortly.' },
        { status: 503 }
      );
    }
    const { token } = claim;
    let res: Response;
    try {
      res = await handler(event);
    } catch (e) {
      releaseClientRecord(key, token);
      throw e;
    }
    if (res.ok) {
      if (!completeClientRecord(key, token)) {
        console.warn(
          `[client-record] ${event.url.pathname} saved ${key} after its claim was taken over; a retry may have saved it too.`
        );
      }
    } else {
      releaseClientRecord(key, token);
    }
    return res;
  };
}
