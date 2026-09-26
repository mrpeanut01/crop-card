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
 *  and writes nothing; a request without one runs unchanged. */
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
    if (res.ok) completeClientRecord(key, token);
    else releaseClientRecord(key, token);
    return res;
  };
}
