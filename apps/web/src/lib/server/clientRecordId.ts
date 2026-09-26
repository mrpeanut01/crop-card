import { json, type RequestHandler } from '@sveltejs/kit';
import {
  claimClientRecord,
  clientRecordStatus,
  completeClientRecord,
  releaseClientRecord
} from '$lib/db/clientRecords';
import { currentOwnerId } from '$lib/db/tenant';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

interface HeldClaim {
  key: string;
  token: number;
  saved: boolean;
  lost: boolean;
}

const claims = new WeakMap<Request, HeldClaim>();

/** Thrown inside a record's write transaction when the replay claim was
 *  taken over as stale, so the record rolls back instead of being saved a
 *  second time next to the new holder's copy. */
export class ClientRecordClaimLost extends Error {
  constructor(key: string) {
    super(`client record ${key} was claimed by another request`);
    this.name = 'ClientRecordClaimLost';
  }
}

/** Marks the replay receipt done with the claim's fencing token. Call inside
 *  the record's write transaction so the record and its receipt commit (or
 *  roll back) together. Throws `ClientRecordClaimLost` when the claim is no
 *  longer held, which rolls the whole record write back. A no-op for
 *  requests without a claimed client record id. */
export function markClientRecordSaved(event: { request: Request }): void {
  const claim = claims.get(event.request);
  if (!claim || claim.saved) return;
  if (!completeClientRecord(claim.key, claim.token)) {
    claim.lost = true;
    throw new ClientRecordClaimLost(claim.key);
  }
  claim.saved = true;
}

function answerForHeldElsewhere(key: string): Response {
  if (clientRecordStatus(key) === 'done') {
    return json({ ok: true, duplicate: true }, { status: 200 });
  }
  return json(
    { error: 'This record is already being saved. It will retry shortly.' },
    { status: 503 }
  );
}

/** Makes a record endpoint safe to replay from the offline queue. A request
 *  carrying a client record id that was already saved gets a success answer
 *  and writes nothing; a request without one runs unchanged.
 *
 *  Handlers save through `writeRecord`, which completes the receipt with the
 *  claim's fencing token inside the record's transaction. A handler that ran
 *  past `STALE_CLAIM_MS` and lost its claim to a retry has its write rolled
 *  back and gets the same duplicate or pending answer a concurrent replay
 *  would. */
export function withClientRecordId(handler: RequestHandler): RequestHandler {
  return async (event) => {
    const raw = event.request.headers.get(CLIENT_RECORD_HEADER);
    const key = raw && ID_PATTERN.test(raw) ? raw : null;
    if (!key || !currentOwnerId()) return handler(event);
    const claimed = claimClientRecord(key, event.url.pathname);
    if (claimed.status !== 'claimed') return answerForHeldElsewhere(key);
    const claim: HeldClaim = { key, token: claimed.token, saved: false, lost: false };
    claims.set(event.request, claim);
    let res: Response;
    try {
      res = await handler(event);
    } catch (e) {
      if (claim.lost || e instanceof ClientRecordClaimLost) return answerForHeldElsewhere(key);
      releaseClientRecord(key, claim.token);
      throw e;
    }
    if (claim.lost) return answerForHeldElsewhere(key);
    if (!res.ok) {
      releaseClientRecord(key, claim.token);
    } else if (!claim.saved && !completeClientRecord(key, claim.token)) {
      console.warn(
        `[client-record] ${event.url.pathname} saved ${key} outside writeRecord after its claim was taken over; a retry may have saved it too.`
      );
    }
    return res;
  };
}
