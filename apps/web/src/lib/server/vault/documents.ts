import { randomUUID } from 'node:crypto';
import { requireOwnerId } from '$lib/db/tenant';
import { isFenced } from '$lib/server/ops/handoff';
import { bodyChunks } from './body';
import { IngestError, VAULT_MAX_FILE_BYTES, sniffAndStrip } from './ingest';
import { hasVaultRepo, vaultRepo, type VaultDocumentKind, type VaultDocumentRow } from './repo';
import { VAULT_OFF_MESSAGE, vaultStore, type VaultBody, type VaultMime } from './store';

export type VaultRefusalCode =
  | 'VAULT_OFF'
  | 'FENCED'
  | 'LENGTH_REQUIRED'
  | 'TOO_LARGE'
  | 'STORAGE_FULL'
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY'
  | 'TRUNCATED'
  | 'ABORTED';

export interface SaveDocumentInput {
  kind: VaultDocumentKind;
  title: string;
  originalName: string | null;
  uploadedBy: string | null;
  body: VaultBody;
  declaredLength: number | null;
  allow?: readonly VaultMime[];
  /** Null: no cap check (photos, the photo migration). */
  capBytes: number | null;
  createdAt?: number;
  /** Runs in the row-insert transaction; throw to abort and delete the bytes. */
  inTransaction?: (doc: VaultDocumentRow) => void;
}

export type SaveDocumentResult =
  | { ok: true; document: VaultDocumentRow }
  | {
      ok: false;
      status: 400 | 409 | 411 | 413 | 415 | 503;
      code: VaultRefusalCode;
      message: string;
    };

export const VAULT_MESSAGES = {
  VAULT_OFF: VAULT_OFF_MESSAGE,
  FENCED: 'The app is updating. Try again in a minute.',
  LENGTH_REQUIRED: "The upload didn't say how big the file is. Try again from the app.",
  TOO_LARGE: 'This file is bigger than 20 MB. Use a smaller file.',
  STORAGE_FULL:
    "Your farm's file storage is full. Delete files or move to a bigger plan to upload more.",
  EMPTY: 'This file is empty.',
  ABORTED: 'Nothing was saved because the record changed during the upload. Try again.'
} as const;

/** Seconds a FENCED caller should wait before retrying. */
export const VAULT_FENCED_RETRY_AFTER_S = 30;

type Refusal = Extract<SaveDocumentResult, { ok: false }>;

const refuse = (status: Refusal['status'], code: VaultRefusalCode, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message
});

/** Bytes promised to uploads still in flight, per Owner. Exact on the single
 *  replica (Invariant 3), like `aiGuard.reserveGuard`. */
const reserved = new Map<string, number>();

export function _reservedBytesForTests(ownerId: string): number {
  return reserved.get(ownerId) ?? 0;
}

class CapExceeded extends Error {}

/**
 * Stream one file into the active Owner's vault and write its row.
 *
 * Order: vault on, not fenced, a sane Content-Length, room under the cap
 * (counting other uploads in flight), then sniff, strip and store, then
 * re-check the cap and insert the row (plus the caller's `inTransaction`)
 * in one transaction. Any refusal after the bytes are stored deletes them.
 */
export async function saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult> {
  const store = vaultStore();
  if (!store || !hasVaultRepo()) return refuse(503, 'VAULT_OFF', VAULT_MESSAGES.VAULT_OFF);
  if (isFenced()) return refuse(503, 'FENCED', VAULT_MESSAGES.FENCED);

  const declared = input.declaredLength;
  if (declared === null || !Number.isSafeInteger(declared) || declared < 0) {
    return refuse(411, 'LENGTH_REQUIRED', VAULT_MESSAGES.LENGTH_REQUIRED);
  }
  if (declared > VAULT_MAX_FILE_BYTES) return refuse(413, 'TOO_LARGE', VAULT_MESSAGES.TOO_LARGE);
  if (declared === 0) return refuse(400, 'EMPTY', VAULT_MESSAGES.EMPTY);

  const repo = vaultRepo();
  const ownerId = requireOwnerId();
  const cap = input.capBytes;
  let held = 0;
  if (cap !== null) {
    const inFlight = reserved.get(ownerId) ?? 0;
    if (repo.liveDocumentBytes() + inFlight + declared > cap) {
      return refuse(413, 'STORAGE_FULL', VAULT_MESSAGES.STORAGE_FULL);
    }
    held = declared;
    reserved.set(ownerId, inFlight + held);
  }

  const id = randomUUID();
  const key = repo.documentStorageKey(ownerId, id);
  let stored = false;
  try {
    let ingest;
    try {
      ingest = await sniffAndStrip(clientChunks(input.body), {
        declaredLength: declared,
        allow: input.allow
      });
    } catch (err) {
      return fromIngestError(err);
    }
    if (isFenced()) {
      await ingest.chunks.return(undefined);
      return refuse(503, 'FENCED', VAULT_MESSAGES.FENCED);
    }
    try {
      await store.put(key, ingest.chunks, { contentType: ingest.mime });
      stored = true;
    } catch (err) {
      await store.delete(key).catch(() => {});
      return fromIngestError(err);
    }
    const info = ingest.info();

    try {
      const document = repo.transaction(() => {
        if (cap !== null && repo.liveDocumentBytes() + info.bytes > cap) {
          throw new CapExceeded();
        }
        const doc = repo.insertDocument({
          id,
          kind: input.kind,
          title: input.title,
          mime: info.mime,
          byteSize: info.bytes,
          sha256: info.sha256,
          crc32: info.crc32,
          storageKey: key,
          originalName: input.originalName,
          uploadedBy: input.uploadedBy,
          ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {})
        });
        input.inTransaction?.(doc);
        return doc;
      });
      stored = false;
      return { ok: true, document };
    } catch (err) {
      if (err instanceof CapExceeded) {
        return refuse(413, 'STORAGE_FULL', VAULT_MESSAGES.STORAGE_FULL);
      }
      if (input.inTransaction) {
        console.warn(`[vault] save aborted: ${(err as Error)?.message ?? err}`);
        return refuse(409, 'ABORTED', VAULT_MESSAGES.ABORTED);
      }
      throw err;
    }
  } finally {
    if (stored) await store.delete(key).catch((e) => logDeleteFailure(key, e));
    if (held > 0) {
      const left = (reserved.get(ownerId) ?? 0) - held;
      if (left > 0) reserved.set(ownerId, left);
      else reserved.delete(ownerId);
    }
  }
}

const TRUNCATED_MESSAGE =
  "The upload didn't arrive in one piece. Check your connection and try again.";

/** The request body, with any read failure (a dropped connection) turned
 *  into TRUNCATED so it is never mistaken for a storage fault. */
async function* clientChunks(body: VaultBody): AsyncGenerator<Uint8Array> {
  try {
    yield* bodyChunks(body);
  } catch (err) {
    if (err instanceof IngestError) throw err;
    throw new IngestError('TRUNCATED', 400, TRUNCATED_MESSAGE);
  }
}

/** Refusals for bad input; anything else (the store failing) is rethrown
 *  so the caller can answer 500 or, for photos, fall back to inline. */
function fromIngestError(err: unknown): Refusal {
  if (err instanceof IngestError) {
    return err.code === 'UNSUPPORTED_TYPE'
      ? refuse(415, 'UNSUPPORTED_TYPE', err.message)
      : refuse(400, 'TRUNCATED', err.message);
  }
  throw err;
}

function logDeleteFailure(key: string, err: unknown): void {
  console.error(`[vault] could not delete ${key}: ${(err as Error)?.message ?? err}`);
}

/** The stored bytes, or null when the vault is off or the bytes are gone. */
export async function openDocument(
  doc: Pick<VaultDocumentRow, 'storageKey'>
): Promise<ReadableStream<Uint8Array> | null> {
  const store = vaultStore();
  if (!store) return null;
  const got = await store.get(doc.storageKey);
  return got?.body ?? null;
}

/** Mark a live document deleted and delete its bytes at once. A failed byte
 *  delete is logged; the orphan sweep removes the file later. */
export async function discardDocument(
  id: string,
  deletedBy: string | null
): Promise<VaultDocumentRow | undefined> {
  if (!hasVaultRepo()) return undefined;
  const row = vaultRepo().markDocumentDeleted(id, deletedBy);
  if (!row) return undefined;
  const store = vaultStore();
  if (store) await store.delete(row.storageKey).catch((e) => logDeleteFailure(row.storageKey, e));
  return row;
}
